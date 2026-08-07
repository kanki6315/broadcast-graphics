using System.Windows;

namespace RaceControl.TelemetryClient;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        if (ClientUpdateService.TryReadInstallerArguments(e.Args, out var processId, out var targetPath, out var expectedSha256))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            _ = RunUpdaterAsync(processId, targetPath, expectedSha256);
            return;
        }

        base.OnStartup(e);
        var executablePath = Environment.ProcessPath;
        if (ClientUpdateService.CanSelfUpdate(executablePath)) ClientUpdateService.CleanupUpdateFiles(executablePath!);
        MainWindow = new MainWindow();
        MainWindow.Show();
    }

    private async Task RunUpdaterAsync(int processId, string targetPath, string expectedSha256)
    {
        try
        {
            await ClientUpdateService.ApplyUpdateAsync(processId, targetPath, expectedSha256);
            Shutdown(0);
        }
        catch (Exception error)
        {
            MessageBox.Show($"The Broadcast Graphics update could not be installed.\n\n{error.Message}", "Update failed", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}
