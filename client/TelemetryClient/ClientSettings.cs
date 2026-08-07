using System.Text.Json;

namespace RaceControl.TelemetryClient;

public enum TelemetrySourceMode
{
    Live,
    Simulation,
    DiagnosticReplay
}

public sealed record ClientSettings(
    string ServerUrl,
    bool RememberKey,
    TelemetrySourceMode SourceMode,
    string? ReplayPath,
    double ReplaySpeed,
    double DiagnosticSampleRate,
    int? DiagnosticDurationMinutes)
{
    public static ClientSettings Default { get; } = new(
        "https://gantry.arjunakankipati.com",
        true,
        TelemetrySourceMode.Live,
        null,
        1,
        1,
        5);
}

public sealed class ClientSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string path = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Broadcast Graphics",
        "settings.json");

    public async Task<ClientSettings> LoadAsync()
    {
        try
        {
            if (!File.Exists(path)) return ClientSettings.Default;
            await using var stream = File.OpenRead(path);
            var settings = await JsonSerializer.DeserializeAsync<ClientSettings>(stream, JsonOptions) ?? ClientSettings.Default;
            return settings with
            {
                ReplaySpeed = settings.ReplaySpeed is 0.5 or 1 or 2 or -1 ? settings.ReplaySpeed : 1
            };
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            return ClientSettings.Default;
        }
    }

    public async Task SaveAsync(ClientSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        await using (var stream = File.Create(temporaryPath))
            await JsonSerializer.SerializeAsync(stream, settings, JsonOptions);
        File.Move(temporaryPath, path, true);
    }
}
