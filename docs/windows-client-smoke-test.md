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
7. Move through practice, qualifying, and race without restarting the client. Confirm telemetry resumes after each SDK reconnect.
8. Restart the server while iRacing remains connected. Confirm the client reports the lost connection, retries, and resumes sending without being restarted.
9. Leave telemetry connected for at least 20 minutes and confirm **Last sent** continues to advance and the server never marks telemetry stale.

## Diagnostics

1. Select **Manual stop**, choose **1 sample / second**, and select **Start Capture**.
2. Exercise the session for at least 30 seconds, then select **Stop & Save**.
3. Confirm the ZIP contains `manifest.json`, SDK variables, raw session information, sampled telemetry, normalized output, and connection events where that data was available.
4. Repeat with a one-minute duration and confirm it stops and saves automatically.
5. Search the extracted files for the ingestion-key prefix; the key must not be present.

## Diagnostic replay

1. Disconnect the live source, select **Diagnostic replay**, and choose the ZIP created above.
2. Confirm the client shows the expected session, track, capture time, duration, sample count, and format before enabling Connect.
3. Against a local server, test `0.5×`, `1×`, `2×`, and maximum speed.
4. During timed playback, pause and resume; confirm no samples advance while paused.
5. Let playback finish and confirm it remains on **Replay complete** without looping.
6. Select **Restart** and confirm playback returns to the first sample and begins again.
7. Point the client at a non-local test server and confirm the remote-replay warning appears before any connection is made. Cancel it once, then confirm it and verify replay starts.
8. Confirm diagnostic-capture controls remain disabled throughout replay.

## Native UI and accessibility

1. At Windows display scaling of 100%, inspect the default and minimum window sizes for clipping or overlap.
2. Repeat at 150% scaling.
3. Use only Tab, Shift+Tab, Space, Enter, arrow keys, and Escape to configure, connect, start/stop a capture, and disconnect.
4. Confirm the orange keyboard-focus outline remains visible on every control.
5. With Windows Narrator running, confirm connection errors, server/source/stream changes, and capture completion are announced once and at a useful time.
6. Inspect disabled, connection-failure, active-capture, saved-capture, and failed-capture states.

Record the executable version, Windows version, display scaling, and any failed step when reporting a test result.
