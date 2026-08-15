# Gantry

A general motorsports broadcast-graphics platform that turns live race data into browser-source graphics and a timing-led solo-operator control panel.

The Gantry identity combines a circular `G`, a timing beam, and an orange terminal sensor. Production logo files and usage guidance live in [`brand/`](brand/README.md).

## Components

- `client/TelemetryClient`: Windows .NET desktop telemetry bridge using `SVappsLAB.iRacingTelemetrySDK`, with live, simulated, and diagnostic-replay sources, local capture, and automatic server reconnection.
- `apps/server`: authoritative live state, WebSocket ingestion/control, package discovery, and production static hosting.
- `apps/web`: the operator panel and consolidated transparent browser overlay.
- `packages/protocol`: shared wire types and semantic graphic-slot definitions.
- `graphic-packages`: runtime-loaded client presentation packages. Add or replace a package without rebuilding the control panel.

The Windows client normalizes iRacing-specific values into explicit race laps, phases, flags, overall/class gaps, intervals, completed-lap metadata, and available camera groups before transmission. See the [telemetry contract](docs/telemetry-contract.md) for field semantics, the [race-history model](docs/race-history.md) for durable lap storage, and the [commentator timing plan](docs/commentator-timing-plan.md) for the implemented read-only endurance timing workspace and circuit-map configuration.

## Quick start

```bash
npm install
npm run dev:server
npm run dev:web
```

Open `http://localhost:5173/timing` for timing and camera direction, and `http://localhost:5173/graphics` for the fixed graphics board. `/control` remains a compatibility entry point for Timing Director. The server starts a simulated session by default. Add the consolidated overlay to vMix/OBS as one transparent browser source. Every graphic taken from Graphics Director appears in this composition:

```text
http://localhost:5173/overlay?package=pri-hoosier-500
```

### Import and calibrate a circuit map

Map configuration is an authenticated operator task; the commentator page remains read-only.

1. Connect live, replay, or simulated telemetry so Gantry has the current exact track layout identity.
2. Open `/control`, choose **Track config**, then use **Import from iRacing** to retrieve the official SVG for the live `track_id`. A local SVG remains available as a fallback.
3. The official import is stored automatically only when its active layer contains one valid closed path. For a local SVG, review the sanitized preview and explicitly choose the path representing the racing centerline. Gantry never guesses when multiple official paths validate.
4. Choose the stored map. Click the centerline at start/finish, select forward or reverse travel, optionally set display rotation, and save a new calibration revision.
5. Review the 10% progression markers against known track direction or a replay. Activate the saved calibration for this layout.
6. In **Sector definition editor**, start from the active native iRacing boundaries, drag handles on the centerline, use arrow keys for 0.5%-lap moves, add a boundary by arming **Add boundary** and clicking the path, or delete an optional boundary. S1/start-finish cannot move here.
7. Save a custom draft. Before racing, activate it to start a new isolated comparison revision. After racing begins, activation is locked and the draft remains available for a future session.
8. Open `/timing`. **Map** uses the calibrated circuit; **Ribbon** persists as a preference and is selected automatically as the fallback when geometry is unavailable or invalid.

Imports are limited to 1 MB and inert SVG paths. Scripts, event handlers, embedded HTML/media, CSS/fonts/images, external URLs, excessive complexity, invalid coordinates, zero-length paths, and unusably open paths are rejected. Never assume a map for another configuration of the same circuit is compatible.

### Windows telemetry client

Build the Windows bridge with the .NET 10 SDK. Running the project opens the desktop client:

```bash
dotnet build client/TelemetryClient
dotnet run --project client/TelemetryClient -- --simulate --server ws://localhost:8787
```

Paste an ingestion key from **Access management**, choose a telemetry source, and select **Connect**. If **Remember this key** is enabled, the secret is stored in Windows Credential Manager; other preferences are stored under the current user's local application data. Disable the server simulator with `DISABLE_SIMULATOR=1` when using the client.

For the hosted service, enter `https://gantry.arjunakankipati.com` as the server URL. The client converts HTTP(S) URLs to the corresponding authenticated WebSocket endpoint. Command-line options remain available to prefill non-secret connection settings:

```powershell
dotnet run --project client/TelemetryClient -- --server https://gantry.arjunakankipati.com
```

Use **Diagnostics** after connecting to capture the SDK variable inventory, raw session YAML, sampled selected telemetry, normalized server payloads, connection events, and client errors. Choose a sampling rate and a fixed duration, or choose **Manual stop** and finish with **Stop & Save**. Captures remain local and are saved as ZIP files; ingestion keys are never written into them.

Choose **Diagnostic replay** to stream a previously captured diagnostic ZIP without iRacing running. The client validates the capture, shows its session sequence, track, driver/class counts, duration, sample count, and format, then replays it at `0.5×`, captured `1×` timing, `2×`, or maximum speed. New captures use normalized output directly; compatible older captures containing SDK telemetry and session information are reconstructed with the current mapper. Replay can be paused, resumed, or restarted; it stops at the final sample and never loops.

```powershell
dotnet run --project client/TelemetryClient -- --replay C:\captures\broadcast-diagnostics.zip --server http://localhost:8787
```

Starting replay against a non-local server requires an explicit confirmation because replay replaces that server's current telemetry state. Diagnostic capture is disabled while an existing capture is being replayed.

Create a self-contained, single-file `win-x64` release from PowerShell:

```powershell
.\client\publish-windows.ps1
```

The distributable is written to `artifacts\windows-client\BroadcastGraphicsClient.exe`. The destination PC does not need a separate .NET installation. Windows may show a SmartScreen warning until releases are code-signed.

The production API publishes the current self-contained executable at [`/api/client/download`](https://gantry.arjunakankipati.com/api/client/download). Its public update manifest is available at [`/api/client/latest`](https://gantry.arjunakankipati.com/api/client/latest) and includes the client version, byte size, and SHA-256 checksum. The Docker build runs the telemetry correctness tests, publishes the `win-x64` executable, generates the manifest and checksum, and includes all three in the API image.

Published clients check the configured server when they start. When a newer version is available, the client downloads it beside the running executable, verifies its size and SHA-256 checksum, starts the verified executable in updater mode, exits, and is atomically replaced and restarted. The previous executable is retained as `BroadcastGraphicsClient.exe.previous` for manual recovery. Automatic replacement requires write access to the directory containing the executable; failures are non-fatal and are recorded in the activity log.

Increment the `<Version>` in `client/TelemetryClient/TelemetryClient.csproj` whenever a client change should roll out. Clients older than `0.6.0` predate the updater and require one final manual replacement from `/api/client/download`; subsequent version increments install automatically.

Before a release, complete the [Windows telemetry client smoke test](docs/windows-client-smoke-test.md), including the 100% and 150% display-scaling checks.

The server requires `ADMIN_PASSWORD` and `DATABASE_URL` in production. In development it prints a random one-time admin password at startup and uses `apps/server/data/auth.json` unless a database URL is supplied. Production access keys, admin sessions, broadcast sessions, entries, drivers, and completed laps are stored in PostgreSQL. Raw telemetry frames remain in memory. Key secrets are hashed and their full value is shown only when created. The access screen generates vMix/OBS overlay URLs with a view key in the URL fragment, keeping it out of ordinary HTTP requests and referrer headers.

Official track-map import uses iRacing's headless OAuth **Password Limited** flow. Set `IRACING_CLIENT_ID`, `IRACING_CLIENT_SECRET`, `IRACING_USERNAME`, and `IRACING_PASSWORD` only in the server environment. Gantry masks both secrets as required before transmission, caches the short-lived access token in memory, and rotates the single-use refresh token. Credentials and tokens are never returned to the browser or written to the database.

## Railway deployment

The repository includes a multi-stage production `Dockerfile` and `railway.toml`. The container tests and publishes the Windows telemetry client, then builds the control panel, overlays, protocol package, and server into one deployment so downloads, HTTP, authentication, and WebSocket traffic share the same origin.

1. Create a Railway project from this GitHub repository and deploy the application service.
2. Add a Railway PostgreSQL service to the same project.
3. Set these application-service variables:

   ```text
   NODE_ENV=production
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<long generated password>
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DISABLE_SIMULATOR=1
   IRACING_CLIENT_ID=<issued OAuth client ID>
   IRACING_CLIENT_SECRET=<issued OAuth client secret>
   IRACING_USERNAME=<authorized iRacing account email>
   IRACING_PASSWORD=<iRacing account password>
   ```

   If the database service has a name other than `Postgres`, use that service name in the reference variable. The server creates its authentication and `bg_*` race-history tables during startup.

4. Confirm that Railway reports `/api/health` as healthy, then open `/control` and create one ingestion key and one view key.
5. Add `gantry.arjunakankipati.com` as the Railway service's custom domain. In Cloudflare DNS, create the CNAME Railway supplies. Keep it DNS-only while validating HTTPS and WebSockets; Cloudflare proxying can be enabled after the end-to-end test succeeds.

Use `https://gantry.arjunakankipati.com` as the desktop telemetry client's production server URL.

Railway deploys should be performed outside a live broadcast. The current live race state is held in one server process, so a deployment restarts the session and connected clients will reconnect automatically. PostgreSQL preserves administrator sessions and access keys across that restart.

## Runtime graphic packages

Every folder under `graphic-packages/` contains:

- `manifest.json`: package identity, tokens, supported slots, and package-safe field schemas.
- `theme.css`: overlay-only presentation. The control panel never imports this CSS.
- optional assets referenced from the manifest or theme.

The server discovers manifests at runtime. The control panel renders semantic controls from the manifest schema, while overlays load the selected package's stylesheet. This is the key boundary that allows different client styles without rebuilding the operator application.

## Camera control

When the Windows client is connected to a live iRacing source, Timing Director keeps every non-scenic camera group reported by the current session in a persistent bank along the bottom of the page. Clicking any timing row immediately selects that driver and sends the car to the currently selected camera group. Pressing a camera-group button switches the selected driver directly to that group. Selected-driver and observed-camera readouts remain separate so an operator can see when live telemetry has caught up with the requested shot. Graphics controls live only on the separate `/graphics` page.

Camera commands travel from the authenticated control socket to the authenticated telemetry client and then through the SDK's simulator-control interface. The control desk shows disconnected, unavailable, sending, sent, and rejected states. A sent state confirms delivery to the SDK, not that iRacing visibly changed shots; iRacing camera commands are fire-and-forget and only work while spectating or watching a replay (out of the car). Simulation and diagnostic-replay telemetry remain read-only.
