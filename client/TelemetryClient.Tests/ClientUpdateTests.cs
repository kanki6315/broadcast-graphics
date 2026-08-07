using RaceControl.TelemetryClient;
using Xunit;

namespace RaceControl.TelemetryClient.Tests;

public sealed class ClientUpdateTests
{
    [Fact]
    public void BuildsHttpManifestUriFromSocketServerUrl()
    {
        var uri = ClientUpdateService.BuildManifestUri("wss://broadcasts.example.com/socket?role=telemetry");
        Assert.Equal("https://broadcasts.example.com/api/client/latest", uri.AbsoluteUri);
    }

    [Fact]
    public void ValidatesExpectedManifestShape()
    {
        ClientUpdateService.ValidateManifest(new ClientUpdateManifest(
            "0.6.0",
            "/api/client/download",
            new string('a', 64),
            100));

        Assert.Throws<InvalidDataException>(() => ClientUpdateService.ValidateManifest(new ClientUpdateManifest(
            "0.6.0",
            "https://other.example/client.exe",
            new string('a', 64),
            100)));
    }

    [Fact]
    public async Task VerifiesDownloadedFileHashAndSize()
    {
        var path = Path.Combine(Path.GetTempPath(), $"client-update-{Guid.NewGuid():N}.bin");
        await File.WriteAllTextAsync(path, "verified update");
        try
        {
            const string hash = "59f19f34399b14e5f1628642e9ce341d660094ba76898e4db6b1875f525b6a6a";
            await ClientUpdateService.VerifyFileAsync(path, 15, hash);
            await Assert.ThrowsAsync<InvalidDataException>(() => ClientUpdateService.VerifyFileAsync(path, 15, new string('0', 64)));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ReadsOnlyConstrainedInstallerArguments()
    {
        var target = Path.GetFullPath("BroadcastGraphicsClient.exe");
        Assert.True(ClientUpdateService.TryReadInstallerArguments(
            ["--apply-update", "123", target, new string('b', 64)],
            out var processId,
            out var parsedTarget,
            out _));
        Assert.Equal(123, processId);
        Assert.Equal(target, parsedTarget);
        Assert.False(ClientUpdateService.TryReadInstallerArguments(
            ["--apply-update", "123", Path.GetFullPath("other.exe"), new string('b', 64)],
            out _, out _, out _));
    }
}
