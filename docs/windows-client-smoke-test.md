# Windows telemetry client smoke test

Run this check on the iRacing PC before treating a client build as release-ready.

## Prepare

1. Pull the latest `main` branch and install the .NET 10 SDK on the build PC.
2. From PowerShell at the repository root, run `./client/publish-windows.ps1`.
3. Launch `artifacts/windows-client/BroadcastGraphicsClient.exe`.
4. In the web control panel, create or select a dedicated ingestion key for this PC.

## Connection and telemetry

1. Confirm the default server is `https://gantry.arjunakankipati.com`.
2. Paste the ingestion key, leave **Live iRacing SDK** selected, and select **Connect**.
3. Start or join an iRacing session.
4. Confirm the written statuses progress to **Connected to graphics server**, an SDK connected state, and **Telemetry flowing** only after the first server acknowledgement.
5. Confirm the control panel timing data follows the active iRacing session.
6. In a race, confirm the displayed current lap equals the leader's completed laps plus one; it must remain zero during parade laps and must not follow the spectator camera's own `Lap` value.
7. Confirm the leader is labeled **Leader**, same-lap cars show overall-leader gaps, and lapped cars show a lap deficit instead of a seconds gap.
8. In a multi-class session, confirm every active class appears and both overall and class positions are one-based.
9. Cross a timing line and confirm the driver's last-lap time and lap number advance once. Confirm the best-lap number changes only when the best time changes.
10. While spectating, confirm the control panel gives every non-scenic camera group its own button. Select a timing row and verify iRacing switches to that car using the selected group.
11. Press another camera-group button. Confirm the current driver stays focused, the shot changes to that group, and the control panel reports `CAMERA SENT`.
12. Disconnect the Windows client and confirm the camera controls disable with explicit disconnected copy while graphic focus remains usable.
13. Right-click a different timing row and choose a camera group. Confirm that driver becomes the shared focus and iRacing switches directly to the requested group. Repeat from the keyboard with both `Shift+F10` and the Context Menu key; use arrow keys and `Enter`, then confirm focus returns to the originating driver control. Reopen the menu and verify both `Escape` and `Tab` dismiss it and restore focus.
14. Observe a start and caution if available. Confirm ready/set/go and caution/one-lap-to-green details agree with iRacing.
15. Disconnect the network briefly, restore it, and confirm the client retries without being restarted.
16. Move through practice, qualifying, and race without restarting the client. Confirm telemetry resumes after each SDK reconnect.
17. Restart the server while iRacing remains connected. Confirm the client reports the lost connection, retries, and resumes sending without being restarted.
18. Leave telemetry connected for at least 20 minutes and confirm **Last acknowledged** continues to advance and the server never marks telemetry stale.
19. Against a test server that accepts telemetry but suppresses acknowledgements, confirm the client shows **Telemetry acknowledgement stalled**, reconnects after approximately three seconds, and resumes without restarting the SDK source when acknowledgements return.
20. With a test SDK source that remains nominally connected but suppresses raw telemetry callbacks, confirm the client shows **Restarting iRacing SDK source**, recreates the source after the watchdog deadline, and resumes without reconnecting a healthy server socket.

## Diagnostics

1. Select **Manual stop**, choose **1 sample / second**, and select **Start Capture**.
2. Exercise the session for at least 30 seconds, then select **Stop & Save**.
3. Confirm the ZIP contains `manifest.json`, SDK variables, raw session information, sampled telemetry, normalized output, and connection/watchdog events where that data was available.
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
