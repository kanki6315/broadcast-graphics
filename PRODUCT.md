# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: a Windows .NET telemetry client for native iRacing SDK access; a TypeScript/Node.js server with PostgreSQL; and React-based browser overlays and control panel. The stack should support local development as well as a separately hosted server.

## Users

The primary user is a solo streamer running an iRacing broadcast. They need to operate the stream, follow the race, and trigger graphics without a separate production crew.

## Product Purpose

The product turns live iRacing session data into broadcast-ready browser graphics. A small client runs on the gaming PC, sends telemetry to a server, and the server distributes current race state to transparent browser overlays and a control panel. Success means a solo operator can add trustworthy timing and race context to a stream with little manual coordination.

## Brand

The product is named **Gantry**. Its mark is a circular `G` interrupted by a horizontal timing beam that terminates at an orange sensor, connecting motorsport timing with live broadcast signaling. The primary identity uses carbon ink, approval orange, technical stock, and the existing Barlow Condensed display face.

## Positioning

One live race-state model powers both the on-air graphics and the operator controls, keeping what the operator sees and what viewers see synchronized.

## Operating Context

- The telemetry client runs on the same Windows PC as iRacing.
- Browser graphics are loaded as transparent web sources in software such as vMix or OBS.
- The operator panel is used during a live session, often on a second display with limited attention available.
- The `/control` operator panel is a private, single-user desktop tool. Mobile layouts and accessibility conformance are outside its required review and acceptance scope.
- The initial workflow emphasizes automatic live data plus quick manual show/hide and content controls.
- The control panel is not a multiview or program monitor; vMix/OBS owns video preview. Its dominant surface is live timing and race context for production decisions.

## Capabilities and Constraints

- Ingest live iRacing session, driver, timing, position, class, lap, start-state, flag, and track-state data through a documented normalized telemetry contract.
- Maintain authoritative current session state in memory and persist broadcast sessions, entries, drivers, completed lap times, and scoring-line gaps in PostgreSQL.
- Serve synchronized browser graphics and an operator control panel in real time.
- Support initial graphics such as a timing tower, race status, driver focus, battle, flag, and lower-third treatments.
- Treat each client-facing graphic style as a replaceable package of layouts, design tokens, assets, and configuration schema. The control panel operates semantic graphic slots and must not require a rebuild when a client package changes presentation.
- Support focused-driver and camera-group control through the live Windows iRacing bridge. Driver selection remains the shared hook for driver-dependent graphics and camera focus.
- Camera commands must expose disconnected, unavailable, pending, sent, and rejected states. Simulation and diagnostic replay remain read-only, and SDK delivery must not be described as verified shot execution.
- The telemetry client must tolerate reconnects and avoid disrupting iRacing.
- The telemetry client can validate and replay its own diagnostic ZIPs for troubleshooting and broadcast rehearsal, with explicit replay states, remote-server confirmation, and no automatic looping.
- Authentication uses one administrator account, browser sessions for control, independently revocable ingestion keys for telemetry clients, and revocable view-only keys for browser overlays.
- Exact deployment target and data-retention window remain open decisions.

## Evidence on Hand

Approved Gantry vector and raster brand assets are stored in `brand/`. No customer claims or benchmarks are currently present. User-provided captures from a Long Beach multi-class event and a Phoenix IndyCar race cover practice, qualifying, race starts, green-flag running, cautions, one-lap-to-green, and restarts. They are available for local replay compatibility testing but are not stored in the repository. Demonstration data must be labeled as simulated.

## Product Principles

- Optimize for one operator with divided attention.
- Keep on-air state and control-room state visibly synchronized.
- Make overlays deterministic, readable, and safe at broadcast resolutions.
- Recover gracefully from telemetry and network interruptions.
- Separate race-data truth from presentation so multiple graphic packages can be added later.
- Keep operator workflows stable across client-specific broadcast packages.

## Accessibility & Inclusion

Broadcast graphics should remain legible at typical compressed-stream viewing sizes. Authentication and access-management surfaces should retain their documented accessibility behavior.

The private `/control` operator panel is intentionally exempt from accessibility auditing and mobile or responsive-view validation. Keyboard-only operation, screen-reader behavior, formal contrast conformance, reduced-motion behavior, touch targets, and narrow-screen layouts are not acceptance criteria for that page. Existing accessible or responsive behavior may remain, but it does not need to be preserved or checked when changing `/control`.
