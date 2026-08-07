using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Serialization;

namespace RaceControl.TelemetryClient;

public sealed record ClientUpdateManifest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("size")] long Size);

public sealed record AvailableClientUpdate(ClientUpdateManifest Manifest, Uri DownloadUri);

public sealed class ClientUpdateService : IDisposable
{
    private const long MaximumDownloadSize = 512L * 1024 * 1024;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(20);
    private readonly HttpClient httpClient;
    private readonly bool ownsHttpClient;

    public ClientUpdateService(HttpClient? httpClient = null)
    {
        this.httpClient = httpClient ?? new HttpClient();
        ownsHttpClient = httpClient is null;
    }

    public static bool CanSelfUpdate(string? executablePath = null) =>
        OperatingSystem.IsWindows() &&
        string.Equals(Path.GetFileName(executablePath ?? Environment.ProcessPath), "BroadcastGraphicsClient.exe", StringComparison.OrdinalIgnoreCase);

    public async Task<AvailableClientUpdate?> CheckAsync(
        string serverUrl,
        Version currentVersion,
        CancellationToken cancellationToken = default)
    {
        var manifestUri = BuildManifestUri(serverUrl);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(RequestTimeout);
        using var response = await httpClient.GetAsync(manifestUri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        var manifest = await response.Content.ReadFromJsonAsync<ClientUpdateManifest>(cancellationToken: timeout.Token)
            ?? throw new InvalidDataException("The server returned an empty client update manifest.");
        ValidateManifest(manifest);
        if (!Version.TryParse(manifest.Version, out var availableVersion))
            throw new InvalidDataException("The client update version is invalid.");
        if (availableVersion <= currentVersion) return null;
        return new AvailableClientUpdate(manifest, new Uri(manifestUri, manifest.Url));
    }

    public async Task<string> DownloadAsync(
        AvailableClientUpdate update,
        string executablePath,
        CancellationToken cancellationToken = default)
    {
        var stagedPath = executablePath + ".update";
        var partialPath = stagedPath + ".download";
        try
        {
            File.Delete(partialPath);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(5));
            using var response = await httpClient.GetAsync(update.DownloadUri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is { } contentLength && contentLength != update.Manifest.Size)
                throw new InvalidDataException("The update download size does not match its manifest.");

            await using (var source = await response.Content.ReadAsStreamAsync(timeout.Token))
            await using (var destination = new FileStream(partialPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81_920, FileOptions.Asynchronous | FileOptions.WriteThrough))
                await source.CopyToAsync(destination, timeout.Token);

            await VerifyFileAsync(partialPath, update.Manifest.Size, update.Manifest.Sha256, timeout.Token);
            File.Move(partialPath, stagedPath, true);
            return stagedPath;
        }
        catch
        {
            TryDelete(partialPath);
            throw;
        }
    }

    public static void LaunchInstaller(string stagedPath, string targetPath, string expectedSha256)
    {
        var startInfo = new ProcessStartInfo(stagedPath) { UseShellExecute = false };
        startInfo.ArgumentList.Add("--apply-update");
        startInfo.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        startInfo.ArgumentList.Add(Path.GetFullPath(targetPath));
        startInfo.ArgumentList.Add(expectedSha256);
        using var installer = Process.Start(startInfo) ?? throw new InvalidOperationException("The update installer could not be started.");
    }

    public static bool TryReadInstallerArguments(IReadOnlyList<string> args, out int processId, out string targetPath, out string expectedSha256)
    {
        processId = 0;
        targetPath = string.Empty;
        expectedSha256 = string.Empty;
        if (args.Count != 4 || !string.Equals(args[0], "--apply-update", StringComparison.Ordinal) ||
            !int.TryParse(args[1], out processId) || processId <= 0 ||
            !Path.IsPathFullyQualified(args[2]) || !IsSha256(args[3])) return false;
        targetPath = Path.GetFullPath(args[2]);
        expectedSha256 = args[3].ToLowerInvariant();
        return string.Equals(Path.GetFileName(targetPath), "BroadcastGraphicsClient.exe", StringComparison.OrdinalIgnoreCase);
    }

    public static async Task ApplyUpdateAsync(int processId, string targetPath, string expectedSha256, CancellationToken cancellationToken = default)
    {
        var stagedPath = Environment.ProcessPath ?? throw new InvalidOperationException("The updater executable path is unavailable.");
        await VerifyFileAsync(stagedPath, null, expectedSha256, cancellationToken);
        await WaitForExitAsync(processId, cancellationToken);

        var replacementPath = targetPath + ".replacement";
        var backupPath = targetPath + ".previous";
        TryDelete(replacementPath);
        File.Copy(stagedPath, replacementPath, true);
        await VerifyFileAsync(replacementPath, null, expectedSha256, cancellationToken);
        if (File.Exists(targetPath)) File.Copy(targetPath, backupPath, true);
        File.Move(replacementPath, targetPath, true);
        Process.Start(new ProcessStartInfo(targetPath) { UseShellExecute = true })?.Dispose();
    }

    public static void CleanupUpdateFiles(string executablePath)
    {
        TryDelete(executablePath + ".update");
        TryDelete(executablePath + ".update.download");
        TryDelete(executablePath + ".replacement");
    }

    internal static Uri BuildManifestUri(string serverUrl)
    {
        if (!Uri.TryCreate(serverUrl.Trim(), UriKind.Absolute, out var parsed))
            throw new ArgumentException("The update server URL is invalid.");
        var builder = new UriBuilder(parsed)
        {
            Scheme = parsed.Scheme.ToLowerInvariant() switch
            {
                "https" or "wss" => "https",
                "http" or "ws" => "http",
                _ => throw new ArgumentException("The update server URL must use HTTPS, HTTP, WSS, or WS."),
            },
            Path = "/api/client/latest",
            Query = string.Empty,
            Fragment = string.Empty,
        };
        return builder.Uri;
    }

    internal static void ValidateManifest(ClientUpdateManifest manifest)
    {
        if (!Version.TryParse(manifest.Version, out _)) throw new InvalidDataException("The client update version is invalid.");
        if (!string.Equals(manifest.Url, "/api/client/download", StringComparison.Ordinal)) throw new InvalidDataException("The client update URL is invalid.");
        if (!IsSha256(manifest.Sha256)) throw new InvalidDataException("The client update SHA-256 is invalid.");
        if (manifest.Size is <= 0 or > MaximumDownloadSize) throw new InvalidDataException("The client update size is invalid.");
    }

    internal static async Task VerifyFileAsync(string path, long? expectedSize, string expectedSha256, CancellationToken cancellationToken = default)
    {
        var info = new FileInfo(path);
        if (expectedSize is { } size && info.Length != size) throw new InvalidDataException("The downloaded update size does not match its manifest.");
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81_920, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(hash), Convert.FromHexString(expectedSha256)))
            throw new InvalidDataException("The downloaded update failed SHA-256 verification.");
    }

    private static async Task WaitForExitAsync(int processId, CancellationToken cancellationToken)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(1));
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (ArgumentException)
        {
            // The original process already exited.
        }
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F');

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    public void Dispose()
    {
        if (ownsHttpClient) httpClient.Dispose();
    }
}
