---
name: Gantry
description: A timing-led production desk and package-driven broadcast graphic system for solo race operators.
colors:
  technical-stock: "#f4f1e8"
  carbon-ink: "#15191c"
  approval-orange: "#ff4b21"
  inspection-green-gray: "#b8c2bd"
  ledger-muted: "#626b68"
  paper-rule: "rgba(21, 25, 28, 0.19)"
  native-rule: "#4d15191c"
  native-interaction-wash: "#26b8c2bd"
  connected-green: "#177344"
  disconnected-ink: "#2b2523"
  disconnected-copy: "#f2c5b8"
  caution-yellow: "#f1c933"
  caution-ink: "#17150a"
  stop-red: "#c53127"
  fastest-purple: "#7e3bd1"
  validation-red: "#8d211b"
  validation-wash: "rgba(197, 49, 39, 0.08)"
  pri-results-copy: "#f7f7f7"
  pri-results-muted: "#8d8d8d"
  pri-results-number-red: "#d71d24"
typography:
  display:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "33px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.015em"
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1
  body:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.2
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  pri-tower-driver:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "18.75px"
    fontWeight: 700
    lineHeight: 1
  pri-tower-position:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "16.67px"
    fontWeight: 700
    lineHeight: 1
  pri-tower-timing:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "18.75px"
    fontWeight: 400
    lineHeight: 1
  pri-tower-descriptor:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "16.67px"
    fontWeight: 400
    lineHeight: 1
  pri-tower-car-number:
    fontFamily: "PRI Apotek Wide, sans-serif"
    fontSize: "20.83px"
    fontWeight: 900
    lineHeight: 1
  pri-tower-session-title:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "22.92px"
    fontWeight: 900
    lineHeight: 1
  pri-tower-clock:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "22.92px"
    fontWeight: 400
    lineHeight: 1
  pri-results-title:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "58.33px"
    fontWeight: 900
    lineHeight: 1
  pri-results-subtitle:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "37.5px"
    fontWeight: 400
    lineHeight: 1
  pri-results-metric-label:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "20.83px"
    fontWeight: 500
    lineHeight: 1
  pri-results-row:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "33.33px"
    fontWeight: 700
    lineHeight: 1
  pri-results-value:
    fontFamily: "PRI Eurostile, sans-serif"
    fontSize: "33.33px"
    fontWeight: 500
    lineHeight: 1
  pri-results-number:
    fontFamily: "PRI Apotek Wide, sans-serif"
    fontSize: "33.33px"
    fontWeight: 900
    lineHeight: 1
  pri-results-footer:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1
  pri-results-unavailable:
    fontFamily: "PRI Eurostile Extended, sans-serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1
rounded:
  square: "0px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  grid-unit: "32px"
components:
  field:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "5px 8px"
    height: "34px"
  cue-row:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
    height: "54px"
  cue-row-live:
    backgroundColor: "{colors.carbon-ink}"
    textColor: "{colors.technical-stock}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
    height: "54px"
  button-take:
    backgroundColor: "{colors.approval-orange}"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.square}"
    height: "48px"
    width: "100%"
  button-clear:
    backgroundColor: "{colors.carbon-ink}"
    textColor: "{colors.technical-stock}"
    typography: "{typography.title}"
    rounded: "{rounded.square}"
    height: "48px"
    width: "100%"
---

# Design System: Gantry

## Overview

**Creative North Star: “Scrutineering Ledger”**

The interface is a live race-production instrument printed on technical stock: timing data, measurement rules, inspection fields, and approval marks arranged for fast decisions under divided attention. It should feel exact, physical, and operational rather than like a generic software dashboard. Timing Director makes live timing and cameras dominant; Graphics Director separates presentation into a fixed, dense switchboard of direct Show/Hide controls.

The global control desk has one durable visual identity, while browser-source overlays inherit their visual identity from the selected graphic package. That boundary is intentional: the control panel always operates semantic graphic slots, and package themes may change palette, type, plate geometry, and depth without restyling the operator workflow.

The native Windows telemetry client is the same Scrutineering Ledger translated into authored WPF controls. It is scan-first rather than dashboard-like: a server/source/stream health strip precedes a connection sheet on the left and diagnostics with activity on the right. Native platform behavior remains intact, but default visual chrome does not replace the shared stock, rules, type, or state language.

## Brand Identity

The Gantry mark is a circular carbon-ink `G` interrupted by a centered horizontal timing beam and a separated approval-orange square sensor. The orange square is the brand's cue endpoint, not a decorative accent. Preserve the supplied geometry, proportions, and gap between the beam and sensor; do not redraw the mark with a different aperture, terminal shape, or line weight.

Use the stacked lockup for brand-led surfaces and the horizontal lockup where width is available. The symbol alone is appropriate for favicons, application icons, compact mastheads, and native-client identity blocks. Wordmarks use Barlow Condensed Bold in uppercase. Canonical masters and export guidance live in `brand/`.

**Key Characteristics:**

- Off-white technical stock, near-black ink, muted gray-green inspection fields, and fluorescent orange state stamps.
- Condensed industrial headings paired with highly legible sans-serif body copy and tabular race data.
- Square controls, dense rules, and visible state labels; no ornamental cards or ambient animation.
- Separate timing-first and graphics-first desktop compositions for the operator's private workstation; `/timing`, `/graphics`, and compatibility `/control` have no mobile-layout requirement.
- Transparent overlays built from stable layouts and runtime package tokens.
- A native telemetry boundary with packaged fonts, explicit health text, square authored controls, and guarded diagnostic replay.

## Colors

The control palette is mostly paper and ink; color is scarce, semantic, and always reinforced by text, icon, border, or shape.

### Primary

- **Approval Orange** (`#ff4b21`): decisive focus, armed/next state, take actions, timestamps, and high-confidence warning outlines. Its rarity gives it authority.

### Secondary

- **Inspection Green-Gray** (`#b8c2bd`): selected fields, hover washes, secondary metadata on dark surfaces, and quiet inspection context.

### Tertiary

- **Caution Yellow** (`#f1c933`): yellow-flag and pit-status plates, always with dark `#17150a` text.
- **Stop Red** (`#c53127`): red-flag state with explicit label text.
- **Fastest Purple** (`#7e3bd1`): fastest-lap data and its written `FASTEST` tag.
- **Connected Green** (`#177344`): healthy-feed icon only; the adjacent `CONNECTED` and `DATA FEED CURRENT` copy carries the meaning.
- **Validation Red** (`#8d211b` on `rgba(197, 49, 39, 0.08)`): authentication, key-creation, key-register, revoke, and sign-out failures, always paired with explicit error copy and alert semantics.
- **PRI Results Number Red** (`#d71d24`): car numbers in the results list only. This is the literal PSD-derived result-number red, distinct from the package's general racing-red accent.

### Neutral

- **Technical Stock** (`#f4f1e8`): the global canvas and pale working surfaces.
- **Carbon Ink** (`#15191c`): primary copy, section rules, selected rows, dark actions, and inverse table headers.
- **Ledger Muted** (`#626b68`): descriptions, secondary data, and field labels.
- **Paper Rule** (`rgba(21, 25, 28, 0.19)`): quiet row dividers and dotted log rules.
- **Native Rule / Interaction Wash** (`#4d15191c` / `#26b8c2bd`): WPF health-strip divisions and restrained hover feedback, expressed as alpha-bearing ARGB resources rather than new hues.
- **Disconnected Ink / Copy** (`#2b2523` / `#f2c5b8`): explicit feed-failure plate and supporting diagnostic text.
- **PRI Results Copy / Muted** (`#f7f7f7` / `#8d8d8d`): PSD-derived result names and values use silver-white; positions, the metric label, and the unavailable message use the quieter gray.

**The Approval Stamp Rule.** Orange marks a state change or decisive action; it is not a general decoration or large ambient background.

**The Redundancy Rule.** Never communicate live, preview, focused, disconnected, fastest, pit, or flag state through color alone.

Authentication follows the same discipline: green is limited to the success icon on a created-key receipt, red belongs to explicit failures, and orange marks selection, focus, confirmation, or the primary action. Loading, pending, empty, active, and revoked states are written out rather than inferred from hue.

## Typography

**Display Font:** Barlow Condensed (sans-serif fallback)

**Body Font:** Source Sans 3 (sans-serif fallback)
**Overlay Package Fonts:** supplied by each graphic package. Endurance Blue retains condensed system display faces and Segoe UI data text. The PRI Hoosier 500 timing tower and results page bypass the generic overlay stacks and load seven supplied OTF masters under three package-local families: `PRI Eurostile`, `PRI Eurostile Extended`, and `PRI Apotek Wide`. The results page adds the Eurostile Medium and Eurostile Extended Medium faces used at weight 500.

The Windows client packages Barlow Condensed and Source Sans 3 in the application and references them with WPF pack URIs. Do not fall back to a system display face for authored native surfaces when those resources are available.

**Character:** Condensed uppercase type gives headings and controls the force of pit-lane labels, while Source Sans 3 keeps instructions and dense operational copy calm. Race values use tabular numerals so columns do not twitch as telemetry changes.

### Hierarchy

- **Display** (700, `33px`, `1`): primary control-panel section heading; `30px` at narrow widths.
- **Title** (700, `23px`, `1`): production-rail headings; masthead identity uses `25px`, major actions use `20–21px`.
- **Body** (400, `14px`, approximately `1.4`): instructions and descriptions, typically constrained to `65ch`.
- **Data** (400, `15px`, tabular numerals): intervals and lap times; emphasis changes weight before it changes size.
- **Label** (600, `10–12px`, `0.05–0.08em`, uppercase): metadata, table headers, status tags, field labels, and keyboard hints.

### PRI Hoosier 500 Timing Tower

- **Drivers:** Eurostile Bold through `PRI Eurostile` (700, `18.75px`, `1`), uppercase.
- **Positions:** Eurostile Bold through `PRI Eurostile` (700, `16.67px`, `1`).
- **Timing values:** Eurostile Regular Oblique through `PRI Eurostile` (400 oblique, `18.75px`, `1`).
- **Descriptor and unit labels:** Eurostile Regular Oblique through `PRI Eurostile` (400 oblique, `16.67px`, `1`).
- **Car numbers:** Apotek Wide Black through `PRI Apotek Wide` (900, `20.83px`, `1`).
- **Session title:** Eurostile Extended Black through `PRI Eurostile Extended` (900, `22.92px`, `1`).
- **Clock:** Eurostile Extended Regular through `PRI Eurostile Extended` (400, `22.92px`, `1`).

These roles reproduce the supplied PSD typography; do not substitute the global Barlow Condensed or Source Sans 3 faces inside this tower.

### PRI Hoosier 500 Results Page

- **Event title:** Eurostile Extended Black through `PRI Eurostile Extended` (900, `58.33px`, `1`).
- **Session subtitle:** Eurostile Extended Regular through `PRI Eurostile Extended` (400, `37.5px`, `1`).
- **Metric label:** Eurostile Extended Medium through `PRI Eurostile Extended` (500, `20.83px`, `1`).
- **Positions and full driver names:** Eurostile Bold through `PRI Eurostile` (700, `33.33px`, `1`), with names uppercase and ellipsized only when the fixed name column overflows.
- **Metric values:** Eurostile Medium through `PRI Eurostile` (500, `33.33px`, `1`).
- **Car numbers:** Apotek Wide Black through `PRI Apotek Wide` (900, `33.33px`, `1`).
- **Presenter line:** Eurostile Extended Regular through `PRI Eurostile Extended` (400, `25px`, `1`).
- **Unavailable state:** Eurostile Extended Medium through `PRI Eurostile Extended` (500, `25px`, `1`).

These roles are literal to the shipped PSD reconstruction. Unlike the timing tower, results rows show each driver's full name rather than extracting a broadcast surname.

**The Condensed Command Rule.** Use Barlow Condensed for headings, labels, statuses, driver identities, and commands; keep explanatory sentences in Source Sans 3.

## Layout

The operator application has two synchronized production desks. `/timing` is graphics-free: a compact session masthead gives way to a full-width scrollable timing ledger where every driver row is an immediate take on the selected camera group. A persistent bottom camera dock keeps the selected driver, requested group, command delivery, and observed driver/group visible together; every available camera group must fit in its center bank without horizontal scrolling. `/graphics` uses a fixed four-column board: race context and timing controls lead, Driver Info and position-based Battle occupy the main working band, planned widgets remain visibly disabled, and the guarded global clear closes the board. Direct Show/Hide actions replace the armed-cue workflow on Graphics Director.

Spacing is compact and multiples cluster around `4`, `8`, `12`, `16`, and `24px`. A faint `32px` vertical registration grid and `8px` horizontal baseline texture make the stock feel measured without competing with data. Major divisions use `2–3px` rules; internal divisions use `1px` rules.

The operator routes are intentionally desktop-only and may keep their dense fixed compositions without a narrow-screen alternative. Do not treat mobile breakpoints, touch ergonomics, keyboard-only operation, screen-reader behavior, reduced motion, or formal contrast conformance as design-review or acceptance requirements for these private surfaces. Responsive or accessible behavior already present may remain, but changes to `/timing`, `/graphics`, or `/control` do not need to preserve or validate it.

Authentication preserves the same measured stock-and-rule composition. Login is a centered sheet no wider than `470px`. Access management uses a `300–390px` key-issue column beside a fluid key register; it stacks at `1050px`. At `700px`, the access masthead becomes a two-row control strip and each register row becomes a labeled vertical record: hide the table header, repeat each field label with `data-label`, use dotted internal dividers, and close each record with a `2px` ink rule. Compact access navigation and row actions must retain at least a `44px` touch target.

The native telemetry client opens centered at `1080 × 760px` with an `880 × 650px` minimum. Its vertical scan is fixed: `82px` identity masthead, `88px` three-cell health strip, flexible work area, then a `34px` privacy/activity footer. The work area uses a `9:11` split with minimum widths of `390px` and `430px`: connection settings scroll independently on the left, while diagnostics sit above a separately ruled activity log on the right. Preserve this source-to-stream reading order; the client is a bridge health instrument, not a telemetry dashboard.

Diagnostic replay expands inside the left connection sheet only when that source is selected. File selection, verification summary, playback speed, high-consequence confirmation, and connect actions stay in the pre-connection flow. Replay transport occupies the same sheet but remains hidden until the bridge is running in replay mode and the server connection is established; it must not imply usable transport before a destination exists.

Overlay layouts are fixed broadcast compositions inside a transparent, pointer-inert viewport. Timing tower, top status, driver focus, battle, lower-third, and results use purpose-built dimensions; do not apply the control-panel responsive grid to them. The PRI Hoosier 500 tower is authored for a fixed `1920 × 1080px` canvas: its shipped proof places the shell at approximately `x = 67px`, `y = 63px`, with an exact `361px` width (measured `67.0078`, `62.9609`, and `361px`). Its default field includes twenty cars, exposes twelve vertical slots, and holds the top five positions fixed.

The PRI Hoosier 500 Results page is also a fixed `1920 × 1080px` composition with no mobile or responsive variant. Place its shell at `x = 289px`, `y = 177px`, sized `1344 × 783px`. Inside that shell, place the embedded raster panel/background at `x = 6px`, `y = 6px`, sized `1332 × 771px`; center the title across the shell at `y = 39px` and the session subtitle at `y = 102px`. Place the embedded event badge at `x = 75px`, `y = 270px`, sized `284 × 305px`, and the embedded separator at `x = 418px`, `y = 193px`, sized `5 × 539px`.

The results metric label sits at `y = 194px`, right-aligned `89px` from the shell edge. The top-ten list starts at `x = 469px`, `y = 220px`, and is `803px` wide; each row is `41.5px` high with `45px / 92px / fluid / 128px` columns for position, car number, full driver name, and value. The Apotek car-number glyphs receive a `-5px` vertical and `0.5px` horizontal optical correction so their visible bounds share the Eurostile row baseline and the PSD number-column center. The presenter footer begins at `x = 371px`, `y = 709px`, and is `43px` high; its text receives a `1px` downward optical correction and the embedded Visitor Watch Company logo is `178 × 42px` with a `31px` leading gap. If the selected session snapshot does not exist, center `RESULTS UNAVAILABLE` over the list region at `x = 469px`, `y = 391px`, width `803px` while retaining the event, title, subtitle, separator, and presenter artwork.

## Elevation & Depth

The control desk is flat. It uses no ambient box shadows: hierarchy comes from tonal fields, border weight, inverse ink plates, and state stamps. The only inset accents are structural state marks, such as the focused-row orange bar or next-cue top rule.

The native client follows the same flat rule. WPF regions are separated by `1–3px` borders, pale alpha washes, inverse footer ink, and state bars; do not add native drop shadows, raised panels, or floating cards.

Overlays are the exception because they must separate from unpredictable video. Package themes may supply a restrained drop shadow (`0 8px 18px rgba(0,0,0,.48)` in PRI Hoosier 500; `0 8px 18px rgba(0,0,0,.4)` in Endurance Blue) and opaque or near-opaque plates.

**The Flat Desk Rule.** Never add floating cards or decorative shadows to the operator surface. Depth belongs to broadcast overlays, where video separation requires it.

## Shapes

Control-panel geometry is square (`0px` radius). Inputs, selects, toggles, row buttons, cue plates, actions, and the emergency clear all use hard corners and visible rules. Decisive state can appear as a stamp, inset stripe, inverse plate, or clipped reveal; avoid pill silhouettes.

Native controls are deliberately authored rather than left to default WPF chrome. Text, password, combo-box, popup, and button templates keep square borders; hover uses the inspection wash, keyboard focus thickens the field rule and adds an external orange focus frame, press/default state thickens the button rule, and disabled controls remain structurally present at `0.48` opacity.

Overlay geometry belongs to the package. The shared layout accepts `--gfx-cut`, but each package may override it with a deliberate broadcast silhouette. PRI Hoosier 500 uses the supplied raster header over a racing-red outer shell, with a `42px` lower shell radius around a lacquer-black inner body whose lower corners use `35px`; its session and descriptor bands remain square. The red shell runs down the left edge and wraps beneath the bottom, fading toward black as it reaches the lower-right corner; the black body sits flush to the straight right edge, so no red rail continues down that side. Other PRI plates use their established `18–24px` radii and `3–4px` red perimeters. Endurance Blue keeps `0px` corners and uses a colored top rule. Package-specific geometry must remain in `graphic-packages/<id>/theme.css`, not in the global control grammar.

## Components

### Buttons

- **Shape:** square, with `1–2px` borders and condensed uppercase labels.
- **Take:** full-width fluorescent orange field, near-black copy, `48px` minimum height, icon plus text, and an `Enter` keyboard hint.
- **Clear:** full-width carbon ink with stock-colored copy. Emergency clear is taller (`66px` minimum), outlined in orange, and requires a second press within three seconds; confirmation reverses to orange and changes both headline and instruction.
- **Focus:** every interactive control receives a `3px` orange `:focus-visible` outline with `2px` offset.
- **Pending / Disabled:** preserve the control's label position, replace its verb with specific progress copy such as `CHECKING CREDENTIALS…`, `CREATING KEY…`, `REVOKING…`, or `SIGNING OUT…`, disable repeat activation, and use the shipped `0.48` opacity treatment.

### Chips and Status Plates

- Status tags are compact outlined rectangles with uppercase text. Focus fills orange, pit fills yellow, and fastest uses purple text plus the literal `FASTEST` label.

### Timing Table

- The sticky header is inverse carbon ink on stock, with compact uppercase labels and right-aligned numeric columns.
- Timing Director rows are a compact `47px` high. Each row is the camera action itself: clicking it, or pressing Enter or Space while it has focus, requests that driver on the currently selected camera group.
- Keep requested and observed state distinct. The selected/requested row uses an inspection wash with a `4px` orange leading rule and orange position stamp; the row observed on camera becomes an inverse ink plate. The persistent key names both states.
- Best-lap emphasis uses tabular numerals and purple ink, reinforced by the persistent `FASTEST LAP` key rather than a dashboard-style badge in every row.

### Persistent Camera Dock

- Keep the dock fixed to the bottom of the first viewport in three ruled regions: selected driver and armed group on the left, the complete camera-group bank with delivery status in the center, and observed driver/group on the right. This requested-versus-observed comparison replaces program preview; vMix/OBS remains the visual authority.
- Camera-group controls act on the selected driver and become the group used by subsequent timing-row takes. Fit every available group into one auto-distributed row of square controls with no horizontal scroll; labels may truncate before the bank wraps or displaces the timing ledger.
- Use at least `44px`-high group controls. Mark requested groups with an orange inset rule, observed-active groups with an inverse ink plate, and write `SELECTED`, `ACTIVE`, or `TAKE` inside each control as applicable.
- Write `DISCONNECTED`, `UNAVAILABLE`, `PENDING`, `SENT`, and `REJECTED` delivery states in operator language beside the group-bank heading. `SENT` confirms SDK delivery, not verified shot execution, so the separate observed-camera readout must remain visible.

### Graphics Director

- Each real semantic slot owns a persistent widget with adjacent `SHOW` and `HIDE` actions, written `OFF` or `ON AIR` state, and its configuration in place.
- Driver Info owns its followed/manual target and optional comparison target. Manual presentation targets never change the Timing Director selection or camera.
- Battle selects a position group through fixed or followed start position and a count of cars behind; `P1` and `F` are explicit quick actions.
- Planned widgets retain the complete future control layout but use disabled controls and written `NOT INSTALLED` state. They do not enter protocol state, package manifests, on-air counts, or overlay output.

### Inputs and Toggles

- Inputs and selects are transparent, `34px` high, square, and bounded by a `1px` ink rule. Labels sit above in small uppercase display type.
- The toggle is a square `42 × 24px` track with a `16px` block thumb. Checked state moves the thumb `18px` and turns it orange.

### Native Health Strip

- Place `SERVER`, `IRACING SOURCE`, and `DATA STREAM` in three equal cells immediately below the native masthead. Each cell combines a `10 × 42px` state bar, condensed uppercase source name, and plain-language status text announced with polite native live-region behavior.
- The state bar is supportive, not sufficient: disconnected or waiting copy remains visible beside it. Truncate only the potentially long source description; never remove the source label or health meaning.

### Native Connection, Diagnostics, and Activity

- The left connection sheet keeps server URL, masked ingestion key, secure local-memory choice, source selector, conditional recording path, and connect/disconnect actions in one vertical sequence. Validation appears immediately before the actions as a focusable, assertive red-outlined panel with wrapping copy.
- The right side keeps diagnostic sampling and duration controls above paired start/stop actions, written status, and capture path. The activity log is a separately ruled lower region with an explicit `CLEAR LOG` action; it is not a decorative console card.
- Close the window with a full-width inverse footer that states the local-key and no-automatic-upload guarantees on the left and last-acknowledged state on the right.

### Native Diagnostic Replay

- Treat replay selection as a preflight, not an immediate start. Disable the connect action while reading or after invalid input; show the verified panel only after compatibility succeeds.
- The inspection-tinted verification panel summarizes the session sequence in order, track, driver and class counts, duration, sample count, and format version. Keep these facts together so an operator can identify the captured race state before it is sent.
- Remote destinations require an inline, focusable, assertively announced confirmation panel immediately above the connect actions. Use a `2px` orange rule, a pale orange wash, explicit cancel/start choices, and return focus to connect when canceled.
- Reveal replay transport only after replay is active and the server is connected. Pair a progress bar with elapsed/total duration and sample position, then provide written `PAUSE`/`RESUME` and `RESTART` controls. Paused and completed conditions must also replace the stream-health text and remove the healthy stream bar; completion disables pause but leaves restart available.
- Disable diagnostic sample-rate, duration, and capture-start controls throughout replay selection and playback. Explain that capture is unavailable while replaying rather than leaving the disabled group ambiguous.

### Authored Native Controls

- Native text, password, and combo fields have a `36px` minimum height, `1px` ink border, transparent or stock background, and packaged body type. Hover adds the inspection wash; keyboard focus uses the orange frame plus a `2px` field rule.
- Native buttons use condensed semibold labels, `40px` minimum height, `14 × 8px` padding, square `1px` rules, and ink overlays for hover/press. Primary orange and dark inverse action pairs increase to `48px`; small tertiary utilities may use the shipped `28px` compact size when adjacent to a full-size field or section title.
- Combo-box popup rows use stock at rest, inspection gray-green when highlighted, and orange plus stronger weight when selected. Preserve normal WPF keyboard navigation and selection semantics inside the authored visual template.

### Admin Login

- Present authentication as an `AUTHORIZED OPERATORS ONLY` ledger sheet with a strong `8px` ink top rule, a `3px` bottom rule, shield mark, plain-language purpose, and a short two-field form.
- Login fields are square, transparent, `42px` high, and use appropriate browser autocomplete. Place initial focus on the password field; expired sessions return to the same login state instead of leaving protected controls visible.
- The primary submit is an orange, icon-labeled command with a `46px` minimum height. Put authentication failure copy inside the form near the fields with `role="alert"`; do not use toast-only failure feedback.

### Access Management and Key Register

- Keep key issuance and the register visually distinct but adjacent. Access type is a two-option radio ledger: the selected option receives an inspection fill and `4px` inset orange leading rule, while its title and explanation remain visible.
- The register preserves label, scope, shortened identifier, issue date, written status, and row action. Active count is a bordered text plate; revoked records use muted ink, strikethrough, the literal `REVOKED` status, and a disabled action.
- Revocation is a two-step inline action. The first press changes the same button to orange `CONFIRM REVOKE`; the pending request changes it to `REVOKING…`. Put a failed revoke directly beneath its record so the error remains attached to the affected key.
- Loading uses `READING KEY REGISTER…` and `CHECKING`; load failure replaces the register with explicit error copy plus a `RETRY KEY REGISTER` action; empty state explains that no keys exist and names the useful first action. Key creation and revocation also announce completion through a nonvisual `role="status"` region.

### One-Time Secret Receipt

- Replace the issue form with a bordered receipt immediately after key creation. Move keyboard focus to the receipt, give it the same orange focus ring, and announce it politely so the one-time reveal cannot be missed.
- Lead with `KEY CREATED` and the irreversible instruction `COPY IT NOW. THE COMPLETE VALUE CANNOT BE SHOWN AGAIN.` Show the read-only secret or example overlay URL in a monospace textarea, then provide explicit copy and done actions.
- Copy success changes icon and text to `COPIED`; clipboard failure appears beside the receipt as an alert and tells the operator to select and copy manually. Never depend on success green alone, and never reveal a full secret later in the key register.

### Overlay Plates

- Shared overlay components position and structure content; package themes own `--gfx-ink`, `--gfx-surface`, `--gfx-surface-soft`, `--gfx-accent`, `--gfx-muted`, `--gfx-font-display`, `--gfx-font-data`, and `--gfx-cut`.
- PRI Hoosier 500 is its own black/red broadcast world: supplied PRI / Hoosier event artwork, exact Eurostile and Apotek typography, lacquer-black and charcoal bands, racing-red perimeter and number cells, silver-white copy, restrained video-separation shadow, and a dense `37.6px` row rhythm. The tower is an exact reproduction of the supplied PSD Leaderboard Pylon, not a reinterpretation or a Gantry-branded variation.
- The tower reads in one fixed vertical story: event header → session title and clock → descriptor and unit → running order. The branded `361 × 76px` raster masthead owns the event-header typography. Below it, the `39px` session band and `28px` descriptor band lead into twelve visible rows by default. Each row preserves the position, car-number cell, uppercase broadcast surname, and timing value. Number cells use the PSD's near-black-at-top to deep-red-at-bottom gradient with no bright inset side rules. Because the exact Eurostile faces sit optically high inside CSS line boxes, session text, descriptors, positions, driver names, and timing values receive a shared `2px` downward baseline correction; the raster masthead and Apotek car numbers do not. Surname particles such as `de`, `van`, and `von` remain attached to the final surname instead of being discarded.
- Practice shows `BEST LAP TIME` / `TIME`; best laps below one minute omit the leading `0:` and render as seconds plus milliseconds. Race shows `RUNNING ORDER` / `INTERVAL`; the first-place value remains `Leader`, while the remaining values use the established gap or laps-behind formatting.
- `totalCars` chooses how many classified drivers are included (default `20`). `visibleRows` chooses the number of vertical slots (default `12`). `fixedPositions` anchors the top positions (default `5`). When the included field exceeds the visible slots, only the lower slots advance to the next page every `15s`; the fixed positions do not move. When the full included field fits, all included rows remain fixed.
- The exact tower typography is defined in the Typography section and frontmatter roles. Driver focus remains a separate `30px` Barlow Condensed treatment; do not apply its generic package typography to the PSD-derived timing tower. The PRI neutral ramp runs from `#030304` through `#313336`, silver copy from `#8f9194` through `#f7f7f5`, and the package accent is `#e10613`.

### PRI Hoosier 500 Results Page

- The pinned visual authority is `/Users/arjunakankipati/Downloads/26-BroadcastElements-Layout-1080.psd`. The shipped page is a direct reconstruction of that PSD's Practice Results smart object at the fixed placement and geometry defined in Layout, not a generic results card or a Gantry-branded reinterpretation.
- Preserve the four embedded raster assets as indivisible visual evidence: the panel/background, PRI Hoosier 500 event badge, vertical separator, and Visitor Watch Company presenter logo. Do not redraw their textures, logos, edge treatment, or sponsor lockup in CSS or text.
- The heading is always `2026 PRI HOOSIER 500`; the subtitle is the selected retained session type followed by `RESULTS`. The operator may select Practice, Qualifying, or Race and may show Speed or Gap to leader. Defaults are Practice and Speed.
- Results use the latest retained snapshot for the selected session type, even after another type becomes current. Include only classified rows with positive positions, sort by position, and show the top ten. Render the driver's full name in uppercase; do not apply the timing tower's surname extraction.
- Speed is miles per hour derived from the driver's best lap over the `2.5-mile` Indianapolis oval: `2.5 × 3600 ÷ best-lap seconds`, displayed to three decimals. Missing, non-finite, or non-positive best laps display an em dash.
- Gap to leader always labels first place `LEADER`. In Practice and Qualifying, each remaining value is the non-negative best-lap difference from the leader in seconds, prefixed with `+` and shown to three decimals. In Race, use `+N LAP` or `+N LAPS` when a driver is lapped; otherwise use the available gap-to-leader or interval in seconds, prefixed with `+` and shown to three decimals. Missing source data displays an em dash.
- When no retained snapshot exists for the selected Practice, Qualifying, or Race session, show the explicit `RESULTS UNAVAILABLE` state rather than substituting the current session or presenting an empty list as valid results.
- This is a fixed broadcast overlay, so it has no mobile behavior, fluid reflow, narrow-screen layout, or breakpoint acceptance criteria.
- Other slots use similarly direct, labeled facts rather than decorative content. Lower-third remains outside the current PRI Hoosier 500 PSD refresh.
- Overlay visibility is a single `180ms ease-out` opacity transition. Package themes may style plates but must preserve legibility at compressed broadcast sizes and transparent canvas behavior.

**The PSD Authority Rule.** For the PRI Hoosier 500 timing tower and Results page, the pinned PSD, extracted raster artwork, measured 1080p placement, typography, and component geometry are authoritative. Preserve them exactly; package extensions must not reinterpret either component.

## Do's and Don'ts

### Do:

- **Do** keep live timing dominant on Timing Director and keep Graphics Director fixed, dense, ordered, and operational.
- **Do** use `1px` rules for measurement, `2px` rules for sections/actions, and `3–4px` orange marks for selected or live state.
- **Do** keep package selection and manifest-defined fields inside the stable Scrutineering Ledger control grammar.
- **Do** use text, icons, borders, patterns, and shape together so color never carries state by itself.
- **Do** reduce motion to effectively zero when `prefers-reduced-motion` is active.
- **Do** keep overlays transparent outside their graphic plates and let package tokens own their client-facing finish.
- **Do** preserve the PRI Hoosier 500 tower at `361px` wide and approximately `67px` from the left and `63px` from the top on a `1920 × 1080px` canvas.
- **Do** keep PRI tower field inclusion, visible slots, and fixed positions as separate controls; rotate only the non-fixed slots at the shipped `15s` cadence.
- **Do** preserve the PRI Hoosier 500 Results page at `x = 289px`, `y = 177px`, `1344 × 783px` on a `1920 × 1080px` canvas, including its embedded raster panel, event badge, separator, and presenter logo.
- **Do** keep results session selection and metric selection independent, default them to Practice and Speed, and render the selected retained snapshot's top ten full-name rows.
- **Do** show `RESULTS UNAVAILABLE` when the requested Practice, Qualifying, or Race snapshot has not been retained.
- **Do** move focus into newly revealed, high-consequence authentication content such as the one-time secret receipt.
- **Do** write every loading, pending, empty, active, revoked, success, and error state in specific operator language.
- **Do** preserve `44px` minimum touch targets for compact access navigation and record actions.
- **Do** keep the Windows client scan order as identity, three-source health, connection/diagnostics work, then privacy and delivery-acknowledgement assurance.
- **Do** package and use the shared Barlow Condensed and Source Sans 3 files in native authored surfaces.
- **Do** pair native state bars with live-updating text so server, source, and stream health remain understandable without color.
- **Do** verify diagnostic replay content and expose its session, track, field-size, duration, sample, and format facts before enabling connection.
- **Do** keep remote replay confirmation inline, move focus into it, and return focus to the initiating connect action when canceled.
- **Do** announce replay progress transitions and write `PAUSED` and `COMPLETE` into stream health instead of relying on a stopped progress bar.

### Don't:

- **Don't** include `/timing`, `/graphics`, or compatibility `/control` in accessibility audits or mobile/responsive review; they are private desktop-only operator surfaces.
- **Don't** add a program-video preview; vMix/OBS remains the source of visual confirmation. Keep direct camera-group actions in the persistent bottom dock with written requested, observed-active, and delivery states.
- **Don't** turn semantic graphic slots into client-specific styling controls.
- **Don't** use rounded cards, pills, gradients, or ambient shadows on the operator desk.
- **Don't** spend orange on passive decoration; reserve it for focus, armed/live progression, time-critical log marks, and decisive actions.
- **Don't** allow a package theme to alter control-panel layout, control styling, or operator terminology.
- **Don't** substitute Gantry's global fonts, redraw supplied PRI or Visitor Watch Company artwork, or reinterpret the PSD-derived tower or Results-page proportions.
- **Don't** make the PRI Results page responsive or create a mobile layout; it is a fixed `1920 × 1080px` broadcast composition.
- **Don't** animate continuously; use only decisive stamp/slide or opacity state changes around `180–260ms`.
- **Don't** use orange or green as generic authentication status fills; reserve orange for action/selection/confirmation and green for a reinforced success cue.
- **Don't** collapse mobile key records into unlabeled values or require horizontal table scrolling for routine access management.
- **Don't** leave keyboard focus behind when the issue form is replaced by the one-time secret receipt.
- **Don't** let default WPF rounding, gradients, shadows, or typography replace the square Scrutineering Ledger control templates.
- **Don't** turn the native telemetry client into a race-data or program-preview dashboard; it configures the bridge and exposes source-to-stream health, diagnostics, and local activity.
- **Don't** reveal replay transport before the server connection exists or present preflight verification as active playback.
- **Don't** permit diagnostic capture controls during replay or remote replay without an explicit inline confirmation step.
