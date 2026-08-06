# Windows telemetry client smoke test

Run this check on the iRacing PC before treating a client build as release-ready.

## Prepare

1. Pull the latest `main` branch and install the .NET 10 SDK on the build PC.
2. From PowerShell at the repository root, run `./client/publish-windows.ps1`.
3. Launch `artifacts/windows-client/BroadcastGraphicsClient.exe`.
4. In the web control panel, create or select a dedicated ingestion key for this PC.

## Connection and telemetry

1. Confirm the default server is `https://broadcasts.arjunakankipati.com`.
2. Paste the ingestion key, leave **Live iRacing SDK** selected, and select **Connect**.
3. Start or join an iRacing session.
4. Confirm the written statuses progress to **Connected to graphics server**, an SDK connected state, and **Telemetry flowing**.
5. Confirm the control panel timing data follows the active iRacing session.
6. Disconnect the network briefly, restore it, and confirm the client retries without being restarted.

## Diagnostics

1. Select **Manual stop**, choose **1 sample / second**, and select **Start Capture**.
2. Exercise the session for at least 30 seconds, then select **Stop & Save**.
3. Confirm the ZIP contains `manifest.json`, SDK variables, raw session information, sampled telemetry, normalized output, and connection events where that data was available.
4. Repeat with a one-minute duration and confirm it stops and saves automatically.
5. Search the extracted files for the ingestion-key prefix; the key must not be present.

## Native UI and accessibility

1. At Windows display scaling of 100%, inspect the default and minimum window sizes for clipping or overlap.
2. Repeat at 150% scaling.
3. Use only Tab, Shift+Tab, Space, Enter, arrow keys, and Escape to configure, connect, start/stop a capture, and disconnect.
4. Confirm the orange keyboard-focus outline remains visible on every control.
5. With Windows Narrator running, confirm connection errors, server/source/stream changes, and capture completion are announced once and at a useful time.
6. Inspect disabled, connection-failure, active-capture, saved-capture, and failed-capture states.

Record the executable version, Windows version, display scaling, and any failed step when reporting a test result.
