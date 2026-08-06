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

## Positioning

One live race-state model powers both the on-air graphics and the operator controls, keeping what the operator sees and what viewers see synchronized.

## Operating Context

- The telemetry client runs on the same Windows PC as iRacing.
- Browser graphics are loaded as transparent web sources in software such as vMix or OBS.
- The operator panel is used during a live session, often on a second display with limited attention available.
- The initial workflow emphasizes automatic live data plus quick manual show/hide and content controls.
- The control panel is not a multiview or program monitor; vMix/OBS owns video preview. Its dominant surface is live timing and race context for production decisions.

## Capabilities and Constraints

- Ingest live iRacing session, driver, timing, position, lap, flag, and track-state data.
- Maintain authoritative current session state on the server and retain useful historical data.
- Serve synchronized browser graphics and an operator control panel in real time.
- Support initial graphics such as a timing tower, race status, driver focus, battle, flag, and lower-third treatments.
- Treat each client-facing graphic style as a replaceable package of layouts, design tokens, assets, and configuration schema. The control panel operates semantic graphic slots and must not require a rebuild when a client package changes presentation.
- Camera-group and focused-driver control are explicitly deferred beyond the first graphics-focused milestone.
- Driver selection is part of the first control-panel information model so it can become the future hook for focused-driver camera control without redesigning the workflow.
- The telemetry client must tolerate reconnects and avoid disrupting iRacing.
- Authentication uses one administrator account, browser sessions for control, independently revocable ingestion keys for telemetry clients, and revocable view-only keys for browser overlays.
- Exact deployment target and data-retention window remain open decisions.

## Evidence on Hand

No brand assets, customer claims, benchmarks, production telemetry samples, or official iRacing SDK integration code are currently present. Demonstration data must be labeled as simulated.

## Product Principles

- Optimize for one operator with divided attention.
- Keep on-air state and control-room state visibly synchronized.
- Make overlays deterministic, readable, and safe at broadcast resolutions.
- Recover gracefully from telemetry and network interruptions.
- Separate race-data truth from presentation so multiple graphic packages can be added later.
- Keep operator workflows stable across client-specific broadcast packages.

## Accessibility & Inclusion

The control panel should be fully keyboard operable, maintain strong contrast, and never communicate race state through color alone. Broadcast graphics should remain legible at typical compressed-stream viewing sizes.
