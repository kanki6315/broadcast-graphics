# Broadcast Graphics

A working MVP for turning iRacing race data into browser-source graphics and a timing-led solo-operator control panel.

## Components

- `client/TelemetryClient`: Windows .NET desktop telemetry bridge using `SVappsLAB.iRacingTelemetrySDK`, with live, simulated, and diagnostic-replay sources, local capture, and automatic server reconnection.
- `apps/server`: authoritative live state, WebSocket ingestion/control, package discovery, and production static hosting.
- `apps/web`: the operator panel and transparent browser-overlay routes.
- `packages/protocol`: shared wire types and semantic graphic-slot definitions.
- `graphic-packages`: runtime-loaded client presentation packages. Add or replace a package without rebuilding the control panel.

## Quick start

```bash
npm install
npm run dev:server
npm run dev:web
```

Open `http://localhost:5173/control`. The server starts a simulated session by default. Add an overlay to vMix/OBS with a transparent browser source such as:

```text
http://localhost:5173/overlay/timing-tower?package=apex
http://localhost:5173/overlay/driver-focus?package=apex
http://localhost:5173/overlay/race-status?package=apex
```

### Windows telemetry client

Build the Windows bridge with the .NET 10 SDK. Running the project opens the desktop client:

```bash
dotnet build client/TelemetryClient
dotnet run --project client/TelemetryClient -- --simulate --server ws://localhost:8787
```

Paste an ingestion key from **Access management**, choose a telemetry source, and select **Connect**. If **Remember this key** is enabled, the secret is stored in Windows Credential Manager; other preferences are stored under the current user's local application data. Disable the server simulator with `DISABLE_SIMULATOR=1` when using the client.

For the hosted service, enter `https://broadcasts.arjunakankipati.com` as the server URL. The client converts HTTP(S) URLs to the corresponding authenticated WebSocket endpoint. Command-line options remain available to prefill non-secret connection settings:

```powershell
dotnet run --project client/TelemetryClient -- --server https://broadcasts.arjunakankipati.com
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

Before a release, complete the [Windows telemetry client smoke test](docs/windows-client-smoke-test.md), including the 100% and 150% display-scaling checks.

The server requires `ADMIN_PASSWORD` and `DATABASE_URL` in production. In development it prints a random one-time admin password at startup and uses `apps/server/data/auth.json` unless a database URL is supplied. Production access keys and admin sessions are stored in PostgreSQL; key secrets are hashed and their full value is shown only when created. The access screen generates vMix/OBS overlay URLs with a view key in the URL fragment, keeping it out of ordinary HTTP requests and referrer headers.

## Railway deployment

The repository includes a multi-stage production `Dockerfile` and `railway.toml`. The container builds the control panel, overlays, protocol package, and server into one deployment so HTTP, authentication, and WebSocket traffic share the same origin.

1. Create a Railway project from this GitHub repository and deploy the application service.
2. Add a Railway PostgreSQL service to the same project.
3. Set these application-service variables:

   ```text
   NODE_ENV=production
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<long generated password>
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DISABLE_SIMULATOR=1
   ```

   If the database service has a name other than `Postgres`, use that service name in the reference variable. The server creates its `bg_access_keys` and `bg_admin_sessions` tables during startup.

4. Confirm that Railway reports `/api/health` as healthy, then open `/control` and create one ingestion key and one view key.
5. Add `broadcasts.arjunakankipati.com` as the Railway service's custom domain. In Cloudflare DNS, create the CNAME Railway supplies. Keep it DNS-only while validating HTTPS and WebSockets; Cloudflare proxying can be enabled after the end-to-end test succeeds.

Use `https://broadcasts.arjunakankipati.com` as the desktop telemetry client's production server URL.

Railway deploys should be performed outside a live broadcast. The current live race state is held in one server process, so a deployment restarts the session and connected clients will reconnect automatically. PostgreSQL preserves administrator sessions and access keys across that restart.

## Runtime graphic packages

Every folder under `graphic-packages/` contains:

- `manifest.json`: package identity, tokens, supported slots, and package-safe field schemas.
- `theme.css`: overlay-only presentation. The control panel never imports this CSS.
- optional assets referenced from the manifest or theme.

The server discovers manifests at runtime. The control panel renders semantic controls from the manifest schema, while overlays load the selected package's stylesheet. This is the key boundary that allows different client styles without rebuilding the operator application.

## Camera-control path

Selecting a timing row emits a semantic `focus.set` command today. A future iRacing control adapter can subscribe to that stable command and translate it into focused-driver and camera-group SDK calls without changing the timing workflow.
