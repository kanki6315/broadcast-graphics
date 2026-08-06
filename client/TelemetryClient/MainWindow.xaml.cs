using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Reflection;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace RaceControl.TelemetryClient;

public partial class MainWindow : Window
{
    private readonly ClientSettingsStore settingsStore = new();
    private readonly WindowsCredentialStore credentialStore = new();
    private readonly DiagnosticCapture diagnostics = new();
    private readonly TelemetryBridge bridge;
    private readonly ObservableCollection<string> logEntries = [];
    private DiagnosticReplayArchive? validatedReplay;
    private CancellationTokenSource? replayValidationCancellation;
    private ReplayProgress? replayProgress;
    private string? pendingReplayServerUrl;
    private bool shutdownComplete;

    public MainWindow()
    {
        InitializeComponent();
        bridge = new TelemetryBridge(diagnostics);
        ActivityLog.ItemsSource = logEntries;
        bridge.StatusChanged += Bridge_StatusChanged;
        bridge.Log += AddLog;
        bridge.ReplayProgressChanged += Bridge_ReplayProgressChanged;
        diagnostics.Completed += Diagnostics_Completed;
        Loaded += MainWindow_Loaded;
        VersionText.Text = $"VERSION {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0"}";
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        var settings = await settingsStore.LoadAsync();
        ServerUrlBox.Text = settings.ServerUrl;
        RememberKeyCheck.IsChecked = settings.RememberKey;
        ReplayPathBox.Text = settings.ReplayPath ?? string.Empty;
        SelectSourceMode(settings.SourceMode);
        SelectComboTag(ReplaySpeedBox, settings.ReplaySpeed.ToString(System.Globalization.CultureInfo.InvariantCulture));
        SelectComboTag(DiagnosticRateBox, settings.DiagnosticSampleRate.ToString(System.Globalization.CultureInfo.InvariantCulture));
        SelectComboTag(DiagnosticDurationBox, (settings.DiagnosticDurationMinutes ?? 0).ToString());

        try
        {
            IngestionKeyBox.Password = credentialStore.Read()
                ?? Environment.GetEnvironmentVariable("BROADCAST_GRAPHICS_INGESTION_KEY")
                ?? string.Empty;
        }
        catch (Exception error)
        {
            AddLog(error.Message);
        }

        ApplyCommandLine();
        UpdateSourceModeUi();
        if (SelectedSourceMode() == TelemetrySourceMode.DiagnosticReplay && !string.IsNullOrWhiteSpace(ReplayPathBox.Text))
            await ValidateReplayAsync(ReplayPathBox.Text);
        AddLog("Client ready. Configure the connection, then select Connect.");
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
        => await TryConnectAsync(false);

    private async Task TryConnectAsync(bool remoteReplayConfirmed)
    {
        ClearError();
        ReplayWarningPanel.Visibility = Visibility.Collapsed;
        try
        {
            var sourceMode = SelectedSourceMode();
            var key = IngestionKeyBox.Password.Trim();
            if (key.Length == 0) throw new InvalidOperationException("Paste an ingestion key created in the web control panel.");
            var endpoint = TelemetryBridge.BuildTelemetryUri(ServerUrlBox.Text);
            if (sourceMode == TelemetrySourceMode.DiagnosticReplay)
            {
                if (validatedReplay is null)
                    await ValidateReplayAsync(ReplayPathBox.Text);
                if (validatedReplay is null)
                    throw new InvalidOperationException("Choose a compatible diagnostic capture before starting replay.");
                if (IsRemoteEndpoint(endpoint) && !remoteReplayConfirmed)
                {
                    pendingReplayServerUrl = ServerUrlBox.Text.Trim();
                    ReplayWarningText.Text = $"This replay will replace the current telemetry state on {endpoint.Host}. Confirm that no live broadcast is using this server.";
                    ReplayWarningPanel.Visibility = Visibility.Visible;
                    ReplayWarningPanel.Focus();
                    Announce(ReplayWarningPanel);
                    return;
                }
            }

            var settings = ReadSettings();
            await settingsStore.SaveAsync(settings);
            if (settings.RememberKey) credentialStore.Write(key);
            else credentialStore.Delete();

            await bridge.StartAsync(new TelemetryBridgeOptions(
                settings.ServerUrl,
                key,
                sourceMode,
                settings.ReplayPath,
                settings.ReplaySpeed));
            pendingReplayServerUrl = null;
            replayProgress = null;
            SetConnectionControls(true);
        }
        catch (Exception error)
        {
            ShowError(error.Message);
            AddLog($"Connection could not start: {error.Message}");
        }
    }

    private async void ConfirmReplay_Click(object sender, RoutedEventArgs e)
    {
        if (!string.Equals(pendingReplayServerUrl, ServerUrlBox.Text.Trim(), StringComparison.Ordinal))
        {
            await TryConnectAsync(false);
            return;
        }
        await TryConnectAsync(true);
    }

    private void CancelReplayWarning_Click(object sender, RoutedEventArgs e)
    {
        pendingReplayServerUrl = null;
        ReplayWarningPanel.Visibility = Visibility.Collapsed;
        ConnectButton.Focus();
    }

    private async void Disconnect_Click(object sender, RoutedEventArgs e)
    {
        DisconnectButton.IsEnabled = false;
        await bridge.StopAsync();
        SetConnectionControls(false);
    }

    private async void StartCapture_Click(object sender, RoutedEventArgs e)
    {
        ClearError();
        var dialog = new SaveFileDialog
        {
            Title = "Save broadcast diagnostics",
            Filter = "Diagnostic capture (*.zip)|*.zip",
            DefaultExt = ".zip",
            AddExtension = true,
            FileName = $"broadcast-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.zip",
            OverwritePrompt = true
        };
        if (dialog.ShowDialog(this) != true) return;

        try
        {
            var sampleRate = double.Parse(SelectedTag(DiagnosticRateBox), System.Globalization.CultureInfo.InvariantCulture);
            var durationMinutes = int.Parse(SelectedTag(DiagnosticDurationBox));
            await diagnostics.StartAsync(new DiagnosticCaptureOptions(
                dialog.FileName,
                sampleRate,
                durationMinutes == 0 ? null : TimeSpan.FromMinutes(durationMinutes)));
            StartCaptureButton.IsEnabled = false;
            StopCaptureButton.IsEnabled = true;
            DiagnosticRateBox.IsEnabled = false;
            DiagnosticDurationBox.IsEnabled = false;
            DiagnosticStatusText.Text = durationMinutes == 0
                ? "CAPTURING · Stop manually when the scenario is complete."
                : $"CAPTURING · Stops after {durationMinutes} minute{(durationMinutes == 1 ? "" : "s")} or when you select Stop & Save.";
            CapturePathText.Text = dialog.FileName;
            AddLog("Diagnostic capture started.");
        }
        catch (Exception error)
        {
            ShowError(error.Message);
            AddLog($"Diagnostic capture could not start: {error.Message}");
        }
    }

    private async void StopCapture_Click(object sender, RoutedEventArgs e)
    {
        StopCaptureButton.IsEnabled = false;
        DiagnosticStatusText.Text = "FINALIZING CAPTURE…";
        await diagnostics.StopAsync();
    }

    private void Diagnostics_Completed(DiagnosticCaptureResult result)
    {
        Dispatcher.BeginInvoke(() =>
        {
            var running = bridge.Status.Running;
            StartCaptureButton.IsEnabled = running && SelectedSourceMode() != TelemetrySourceMode.DiagnosticReplay;
            StopCaptureButton.IsEnabled = false;
            DiagnosticRateBox.IsEnabled = true;
            DiagnosticDurationBox.IsEnabled = true;
            if (result.Error is null)
            {
                DiagnosticStatusText.Text = $"CAPTURE SAVED · {result.FinishedAt - result.StartedAt:mm\\:ss}";
                CapturePathText.Text = result.DestinationPath;
                AddLog($"Diagnostic capture saved to {result.DestinationPath}");
            }
            else
            {
                DiagnosticStatusText.Text = "CAPTURE FAILED · See the activity log.";
                AddLog($"Diagnostic capture failed: {result.Error.Message}");
            }
            Announce(DiagnosticStatusText);
        });
    }

    private void Bridge_StatusChanged(TelemetryBridgeStatus status)
    {
        Dispatcher.BeginInvoke(() =>
        {
            var previousServer = ServerStatusText.Text;
            var previousSource = SourceStatusText.Text;
            var previousStream = StreamStatusText.Text;
            SetIndicator(ServerIndicator, status.ServerConnected);
            ServerStatusText.Text = status.ServerConnected ? "Connected to graphics server" : status.Running ? "Connecting / retrying" : "Not connected";
            SetIndicator(SourceIndicator, status.SourceConnected);
            SourceStatusText.Text = status.SourceLabel;
            var replayActive = status.Running && SelectedSourceMode() == TelemetrySourceMode.DiagnosticReplay;
            var replayPaused = replayActive && replayProgress?.IsPaused == true;
            var replayComplete = replayActive && replayProgress?.IsComplete == true;
            SetIndicator(StreamIndicator, status.Streaming && !replayPaused && !replayComplete);
            StreamStatusText.Text = replayComplete
                ? "Replay complete"
                : replayPaused
                    ? "Replay paused"
                    : status.Streaming ? "Telemetry flowing" : status.SourceConnected ? "Waiting for server" : "Waiting for telemetry";
            ReplayTransportPanel.Visibility = replayActive && status.ServerConnected ? Visibility.Visible : Visibility.Collapsed;
            LastSentText.Text = status.LastTelemetryAt is { } sent
                ? $"LAST SENT {sent.ToLocalTime():HH:mm:ss}"
                : "NO TELEMETRY SENT";

            if (!string.Equals(previousServer, ServerStatusText.Text, StringComparison.Ordinal)) Announce(ServerStatusText);
            if (!string.Equals(previousSource, SourceStatusText.Text, StringComparison.Ordinal)) Announce(SourceStatusText);
            if (!string.Equals(previousStream, StreamStatusText.Text, StringComparison.Ordinal)) Announce(StreamStatusText);

            if (!status.Running)
            {
                SetConnectionControls(false);
                if (diagnostics.IsCapturing) _ = diagnostics.StopAsync("telemetry bridge stopped");
            }
            else
            {
                StartCaptureButton.IsEnabled = SelectedSourceMode() != TelemetrySourceMode.DiagnosticReplay && !diagnostics.IsCapturing;
            }
        });
    }

    private void SetConnectionControls(bool running)
    {
        ConnectButton.IsEnabled = !running;
        DisconnectButton.IsEnabled = running;
        ServerUrlBox.IsEnabled = !running;
        IngestionKeyBox.IsEnabled = !running;
        RememberKeyCheck.IsEnabled = !running;
        ForgetKeyButton.IsEnabled = !running;
        SourceModeBox.IsEnabled = !running;
        var replay = SelectedSourceMode() == TelemetrySourceMode.DiagnosticReplay;
        ReplayPathBox.IsEnabled = !running && replay;
        BrowseReplayButton.IsEnabled = !running && replay;
        ReplaySpeedBox.IsEnabled = !running && replay;
        ReplayTransportPanel.Visibility = running && replay && bridge.Status.ServerConnected ? Visibility.Visible : Visibility.Collapsed;
        StartCaptureButton.IsEnabled = running && !replay && !diagnostics.IsCapturing;
        DiagnosticRateBox.IsEnabled = !replay && !diagnostics.IsCapturing;
        DiagnosticDurationBox.IsEnabled = !replay && !diagnostics.IsCapturing;
        if (!running && !diagnostics.IsCapturing)
            DiagnosticStatusText.Text = "Connect the bridge to enable diagnostics.";
        if (replay)
            DiagnosticStatusText.Text = "Diagnostic capture is unavailable while replaying an existing capture.";
    }

    private void SourceMode_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        validatedReplay = null;
        ReplayWarningPanel.Visibility = Visibility.Collapsed;
        UpdateSourceModeUi();
        if (SelectedSourceMode() == TelemetrySourceMode.DiagnosticReplay && !string.IsNullOrWhiteSpace(ReplayPathBox.Text))
            _ = ValidateReplayAsync(ReplayPathBox.Text);
    }

    private async void BrowseReplay_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select a Broadcast Graphics diagnostic capture",
            Filter = "Diagnostic capture (*.zip)|*.zip|All files (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != true) return;
        ReplayPathBox.Text = dialog.FileName;
        await ValidateReplayAsync(dialog.FileName);
    }

    private void ReplayPause_Click(object sender, RoutedEventArgs e)
    {
        var pause = replayProgress?.IsPaused != true;
        bridge.SetReplayPaused(pause);
    }

    private void ReplayRestart_Click(object sender, RoutedEventArgs e) => bridge.RestartReplay();

    private void Bridge_ReplayProgressChanged(ReplayProgress progress)
    {
        Dispatcher.BeginInvoke(() =>
        {
            var previousProgress = replayProgress;
            replayProgress = progress;
            ReplayProgressBar.Maximum = Math.Max(progress.SampleCount, 1);
            ReplayProgressBar.Value = Math.Min(progress.SampleNumber, ReplayProgressBar.Maximum);
            ReplayProgressText.Text = $"{FormatDuration(progress.Position)} / {FormatDuration(progress.Duration)} · {progress.SampleNumber:N0}/{progress.SampleCount:N0}";
            ReplayPauseButton.Content = progress.IsPaused ? "RESUME" : "PAUSE";
            ReplayPauseButton.IsEnabled = !progress.IsComplete;
            ReplayRestartButton.IsEnabled = true;
            if (progress.IsComplete)
            {
                StreamStatusText.Text = "Replay complete";
                SetIndicator(StreamIndicator, false);
            }
            else if (progress.IsPaused)
            {
                StreamStatusText.Text = "Replay paused";
                SetIndicator(StreamIndicator, false);
            }
            if (previousProgress is null ||
                previousProgress.IsPaused != progress.IsPaused ||
                previousProgress.IsComplete != progress.IsComplete ||
                progress.SampleNumber == 0)
                Announce(ReplayProgressText);
        });
    }

    private void ForgetKey_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            credentialStore.Delete();
            IngestionKeyBox.Clear();
            RememberKeyCheck.IsChecked = false;
            AddLog("Saved ingestion key removed from Windows Credential Manager.");
        }
        catch (Exception error)
        {
            ShowError(error.Message);
        }
    }

    private void ClearLog_Click(object sender, RoutedEventArgs e) => logEntries.Clear();

    private void AddLog(string message)
    {
        Dispatcher.BeginInvoke(() =>
        {
            logEntries.Add($"{DateTime.Now:HH:mm:ss}  {message}");
            while (logEntries.Count > 250) logEntries.RemoveAt(0);
            if (logEntries.Count > 0) ActivityLog.ScrollIntoView(logEntries[^1]);
        });
    }

    private ClientSettings ReadSettings()
    {
        var duration = int.Parse(SelectedTag(DiagnosticDurationBox));
        return new ClientSettings(
            ServerUrlBox.Text.Trim(),
            RememberKeyCheck.IsChecked == true,
            SelectedSourceMode(),
            string.IsNullOrWhiteSpace(ReplayPathBox.Text) ? null : ReplayPathBox.Text.Trim(),
            double.Parse(SelectedTag(ReplaySpeedBox), System.Globalization.CultureInfo.InvariantCulture),
            double.Parse(SelectedTag(DiagnosticRateBox), System.Globalization.CultureInfo.InvariantCulture),
            duration == 0 ? null : duration);
    }

    private TelemetrySourceMode SelectedSourceMode() =>
        Enum.TryParse<TelemetrySourceMode>(SelectedTag(SourceModeBox), out var mode) ? mode : TelemetrySourceMode.Live;

    private void SelectSourceMode(TelemetrySourceMode mode)
    {
        SelectComboTag(SourceModeBox, mode.ToString());
        ReplayFilePanel.Visibility = mode == TelemetrySourceMode.DiagnosticReplay ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string SelectedTag(ComboBox comboBox) =>
        (comboBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "0";

    private static void SelectComboTag(ComboBox comboBox, string value)
    {
        var item = comboBox.Items.OfType<ComboBoxItem>()
            .FirstOrDefault(candidate => string.Equals(candidate.Tag?.ToString(), value, StringComparison.OrdinalIgnoreCase));
        comboBox.SelectedItem = item ?? comboBox.Items[0];
    }

    private static void SetIndicator(Border indicator, bool healthy) =>
        indicator.Background = (Brush)Application.Current.Resources[healthy ? "GoodBrush" : "BadBrush"];

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorPanel.Visibility = Visibility.Visible;
        ErrorPanel.Focus();
        Announce(ErrorPanel);
    }

    private void ClearError()
    {
        ErrorText.Text = string.Empty;
        ErrorPanel.Visibility = Visibility.Collapsed;
    }

    private static void Announce(UIElement element)
    {
        var peer = UIElementAutomationPeer.FromElement(element) ?? UIElementAutomationPeer.CreatePeerForElement(element);
        peer?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
    }

    private void ApplyCommandLine()
    {
        var args = Environment.GetCommandLineArgs().Skip(1).ToArray();
        if (args.Contains("--simulate", StringComparer.OrdinalIgnoreCase)) SelectSourceMode(TelemetrySourceMode.Simulation);
        var serverIndex = Array.IndexOf(args, "--server");
        if (serverIndex >= 0 && serverIndex + 1 < args.Length) ServerUrlBox.Text = args[serverIndex + 1];
        var replayIndex = Array.IndexOf(args, "--replay");
        if (replayIndex >= 0 && replayIndex + 1 < args.Length)
        {
            SelectSourceMode(TelemetrySourceMode.DiagnosticReplay);
            ReplayPathBox.Text = args[replayIndex + 1];
        }
    }

    private void UpdateSourceModeUi()
    {
        var replay = SelectedSourceMode() == TelemetrySourceMode.DiagnosticReplay;
        ReplayFilePanel.Visibility = replay ? Visibility.Visible : Visibility.Collapsed;
        ReplayPathBox.IsEnabled = replay && !bridge.Status.Running;
        BrowseReplayButton.IsEnabled = replay && !bridge.Status.Running;
        ReplaySpeedBox.IsEnabled = replay && !bridge.Status.Running;
        ConnectButton.Content = replay ? "CONNECT & START REPLAY" : "CONNECT";
        DiagnosticRateBox.IsEnabled = !replay && !diagnostics.IsCapturing;
        DiagnosticDurationBox.IsEnabled = !replay && !diagnostics.IsCapturing;
        StartCaptureButton.IsEnabled = bridge.Status.Running && !replay && !diagnostics.IsCapturing;
        ConnectButton.IsEnabled = !bridge.Status.Running && (!replay || validatedReplay is not null);
        if (replay)
            DiagnosticStatusText.Text = "Diagnostic capture is unavailable while replaying an existing capture.";
        else if (!bridge.Status.Running)
            DiagnosticStatusText.Text = "Connect the bridge to enable diagnostics.";
    }

    private async Task ValidateReplayAsync(string path)
    {
        replayValidationCancellation?.Cancel();
        replayValidationCancellation?.Dispose();
        replayValidationCancellation = new CancellationTokenSource();
        var cancellationToken = replayValidationCancellation.Token;
        validatedReplay = null;
        ReplaySummaryPanel.Visibility = Visibility.Collapsed;
        ReplayValidationText.Foreground = (Brush)Application.Current.Resources["MutedBrush"];
        ReplayValidationText.Text = "READING DIAGNOSTIC CAPTURE…";
        ConnectButton.IsEnabled = false;
        try
        {
            var archive = await Task.Run(() => DiagnosticReplayArchive.LoadAsync(path, cancellationToken), cancellationToken);
            if (cancellationToken.IsCancellationRequested || !string.Equals(path, ReplayPathBox.Text, StringComparison.Ordinal)) return;
            validatedReplay = archive;
            ReplaySessionText.Text = string.Join(" → ", archive.Info.SessionNames);
            ReplayTrackText.Text = $"{archive.Info.TrackName} · {archive.Info.DriverCount:N0} drivers · {archive.Info.ClassCount:N0} classes";
            ReplayDetailsText.Text = $"Captured {archive.Info.CapturedAt.ToLocalTime():MMM d, yyyy h:mm tt} · {FormatDuration(archive.Info.Duration)} · {archive.Info.SampleCount:N0} samples · format {archive.Info.FormatVersion}";
            ReplayValidationText.Text = $"Compatible replay found · {archive.Info.StreamKind}.";
            ReplaySummaryPanel.Visibility = Visibility.Visible;
            ConnectButton.IsEnabled = !bridge.Status.Running;
            Announce(ReplayValidationText);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (cancellationToken.IsCancellationRequested) return;
            ReplayValidationText.Foreground = (Brush)Application.Current.Resources["ErrorBrush"];
            ReplayValidationText.Text = error.Message;
            ConnectButton.IsEnabled = false;
            Announce(ReplayValidationText);
        }
    }

    private static bool IsRemoteEndpoint(Uri endpoint)
    {
        if (string.Equals(endpoint.Host, "localhost", StringComparison.OrdinalIgnoreCase)) return false;
        return !System.Net.IPAddress.TryParse(endpoint.Host, out var address) || !System.Net.IPAddress.IsLoopback(address);
    }

    private static string FormatDuration(TimeSpan duration) =>
        duration.TotalHours >= 1 ? duration.ToString(@"h\:mm\:ss") : duration.ToString(@"mm\:ss");

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (shutdownComplete) return;
        e.Cancel = true;
        IsEnabled = false;
        await bridge.DisposeAsync();
        replayValidationCancellation?.Cancel();
        replayValidationCancellation?.Dispose();
        await diagnostics.DisposeAsync();
        try { await settingsStore.SaveAsync(ReadSettings()); } catch { }
        shutdownComplete = true;
        Close();
    }
}
