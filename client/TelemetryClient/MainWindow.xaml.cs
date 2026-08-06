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
    private bool shutdownComplete;

    public MainWindow()
    {
        InitializeComponent();
        bridge = new TelemetryBridge(diagnostics);
        ActivityLog.ItemsSource = logEntries;
        bridge.StatusChanged += Bridge_StatusChanged;
        bridge.Log += AddLog;
        diagnostics.Completed += Diagnostics_Completed;
        Loaded += MainWindow_Loaded;
        VersionText.Text = $"VERSION {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0"}";
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        var settings = await settingsStore.LoadAsync();
        ServerUrlBox.Text = settings.ServerUrl;
        RememberKeyCheck.IsChecked = settings.RememberKey;
        IbtPathBox.Text = settings.IbtPath ?? string.Empty;
        SelectSourceMode(settings.SourceMode);
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
        AddLog("Client ready. Configure the connection, then select Connect.");
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        ClearError();
        try
        {
            var sourceMode = SelectedSourceMode();
            var key = IngestionKeyBox.Password.Trim();
            if (key.Length == 0) throw new InvalidOperationException("Paste an ingestion key created in the web control panel.");
            _ = TelemetryBridge.BuildTelemetryUri(ServerUrlBox.Text);
            if (sourceMode == TelemetrySourceMode.IbtPlayback && !File.Exists(IbtPathBox.Text))
                throw new InvalidOperationException("Choose an existing IBT recording before connecting.");

            var settings = ReadSettings();
            await settingsStore.SaveAsync(settings);
            if (settings.RememberKey) credentialStore.Write(key);
            else credentialStore.Delete();

            await bridge.StartAsync(new TelemetryBridgeOptions(
                settings.ServerUrl,
                key,
                sourceMode,
                settings.IbtPath));
            SetConnectionControls(true);
        }
        catch (Exception error)
        {
            ShowError(error.Message);
            AddLog($"Connection could not start: {error.Message}");
        }
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
            StartCaptureButton.IsEnabled = running;
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
            SetIndicator(StreamIndicator, status.Streaming);
            StreamStatusText.Text = status.Streaming ? "Telemetry flowing" : status.SourceConnected ? "Waiting for server" : "Waiting for telemetry";
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
                StartCaptureButton.IsEnabled = !diagnostics.IsCapturing;
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
        IbtPathBox.IsEnabled = !running && SelectedSourceMode() == TelemetrySourceMode.IbtPlayback;
        StartCaptureButton.IsEnabled = running && !diagnostics.IsCapturing;
        if (!running && !diagnostics.IsCapturing)
            DiagnosticStatusText.Text = "Connect the bridge to enable diagnostics.";
    }

    private void SourceMode_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        var ibt = SelectedSourceMode() == TelemetrySourceMode.IbtPlayback;
        IbtFilePanel.Visibility = ibt ? Visibility.Visible : Visibility.Collapsed;
        IbtPathBox.IsEnabled = ibt && !bridge.Status.Running;
    }

    private void BrowseIbt_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select an iRacing telemetry recording",
            Filter = "iRacing telemetry (*.ibt)|*.ibt|All files (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) == true) IbtPathBox.Text = dialog.FileName;
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
            string.IsNullOrWhiteSpace(IbtPathBox.Text) ? null : IbtPathBox.Text.Trim(),
            double.Parse(SelectedTag(DiagnosticRateBox), System.Globalization.CultureInfo.InvariantCulture),
            duration == 0 ? null : duration);
    }

    private TelemetrySourceMode SelectedSourceMode() =>
        Enum.TryParse<TelemetrySourceMode>(SelectedTag(SourceModeBox), out var mode) ? mode : TelemetrySourceMode.Live;

    private void SelectSourceMode(TelemetrySourceMode mode)
    {
        SelectComboTag(SourceModeBox, mode.ToString());
        var ibt = mode == TelemetrySourceMode.IbtPlayback;
        IbtFilePanel.Visibility = ibt ? Visibility.Visible : Visibility.Collapsed;
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
        var ibtIndex = Array.IndexOf(args, "--ibt");
        if (ibtIndex >= 0 && ibtIndex + 1 < args.Length)
        {
            SelectSourceMode(TelemetrySourceMode.IbtPlayback);
            IbtPathBox.Text = args[ibtIndex + 1];
        }
    }

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (shutdownComplete) return;
        e.Cancel = true;
        IsEnabled = false;
        await bridge.DisposeAsync();
        await diagnostics.DisposeAsync();
        try { await settingsStore.SaveAsync(ReadSettings()); } catch { }
        shutdownComplete = true;
        Close();
    }
}
