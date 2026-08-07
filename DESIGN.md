---
name: Broadcast Graphics
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

# Design System: Broadcast Graphics

## Overview

**Creative North Star: “Scrutineering Ledger”**

The interface is a live race-production instrument printed on technical stock: timing data, measurement rules, inspection fields, and approval marks arranged for fast decisions under divided attention. It should feel exact, physical, and operational rather than like a generic software dashboard. Live timing is the dominant working surface; the narrower production rail carries the cue, its package-defined fields, recent events, and emergency clear.

The global control desk has one durable visual identity, while browser-source overlays inherit their visual identity from the selected graphic package. That boundary is intentional: the control panel always operates semantic graphic slots, and package themes may change palette, type, plate geometry, and depth without restyling the operator workflow.

The native Windows telemetry client is the same Scrutineering Ledger translated into authored WPF controls. It is scan-first rather than dashboard-like: a server/source/stream health strip precedes a connection sheet on the left and diagnostics with activity on the right. Native platform behavior remains intact, but default visual chrome does not replace the shared stock, rules, type, or state language.

**Key Characteristics:**

- Off-white technical stock, near-black ink, muted gray-green inspection fields, and fluorescent orange state stamps.
- Condensed industrial headings paired with highly legible sans-serif body copy and tabular race data.
- Square controls, dense rules, and visible state labels; no ornamental cards or ambient animation.
- A timing-first desktop composition for the operator's private workstation; `/control` has no mobile-layout requirement.
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

### Neutral

- **Technical Stock** (`#f4f1e8`): the global canvas and pale working surfaces.
- **Carbon Ink** (`#15191c`): primary copy, section rules, selected rows, dark actions, and inverse table headers.
- **Ledger Muted** (`#626b68`): descriptions, secondary data, and field labels.
- **Paper Rule** (`rgba(21, 25, 28, 0.19)`): quiet row dividers and dotted log rules.
- **Native Rule / Interaction Wash** (`#4d15191c` / `#26b8c2bd`): WPF health-strip divisions and restrained hover feedback, expressed as alpha-bearing ARGB resources rather than new hues.
- **Disconnected Ink / Copy** (`#2b2523` / `#f2c5b8`): explicit feed-failure plate and supporting diagnostic text.

**The Approval Stamp Rule.** Orange marks a state change or decisive action; it is not a general decoration or large ambient background.

**The Redundancy Rule.** Never communicate live, preview, focused, disconnected, fastest, pit, or flag state through color alone.

Authentication follows the same discipline: green is limited to the success icon on a created-key receipt, red belongs to explicit failures, and orange marks selection, focus, confirmation, or the primary action. Loading, pending, empty, active, and revoked states are written out rather than inferred from hue.

## Typography

**Display Font:** Barlow Condensed (sans-serif fallback)

**Body Font:** Source Sans 3 (sans-serif fallback)
**Overlay Package Fonts:** supplied through `--gfx-font-display` and `--gfx-font-data`; Apex Signal uses the shipped Barlow Condensed and Source Sans 3 faces, while Endurance Blue retains condensed system display faces and Segoe UI data text.

The Windows client packages Barlow Condensed and Source Sans 3 in the application and references them with WPF pack URIs. Do not fall back to a system display face for authored native surfaces when those resources are available.

**Character:** Condensed uppercase type gives headings and controls the force of pit-lane labels, while Source Sans 3 keeps instructions and dense operational copy calm. Race values use tabular numerals so columns do not twitch as telemetry changes.

### Hierarchy

- **Display** (700, `33px`, `1`): primary control-panel section heading; `30px` at narrow widths.
- **Title** (700, `23px`, `1`): production-rail headings; masthead identity uses `25px`, major actions use `20–21px`.
- **Body** (400, `14px`, approximately `1.4`): instructions and descriptions, typically constrained to `65ch`.
- **Data** (400, `15px`, tabular numerals): intervals and lap times; emphasis changes weight before it changes size.
- **Label** (600, `10–12px`, `0.05–0.08em`, uppercase): metadata, table headers, status tags, field labels, and keyboard hints.

**The Condensed Command Rule.** Use Barlow Condensed for headings, labels, statuses, driver identities, and commands; keep explanatory sentences in Source Sans 3.

## Layout

The control panel is a timing-led production desk. A four-cell masthead sits above a two-column grid: the timing director takes all available space and the production rail stays between `340px` and `410px`. Timing has a scrollable table with a sticky ink header, followed by a focused-driver ledger. The rail stacks cue sequence, cue list, schema-driven inspector, event log, and emergency clear with strong horizontal rules rather than card gaps.

Spacing is compact and multiples cluster around `4`, `8`, `12`, `16`, and `24px`. A faint `32px` vertical registration grid and `8px` horizontal baseline texture make the stock feel measured without competing with data. Major divisions use `2–3px` rules; internal divisions use `1px` rules.

The `/control` route is intentionally desktop-only and may keep its timing-led two-column composition without a narrow-screen alternative. Do not treat mobile breakpoints, touch ergonomics, keyboard-only operation, screen-reader behavior, reduced motion, or formal contrast conformance as design-review or acceptance requirements for this private single-user surface. Responsive or accessible behavior already present may remain, but changes to `/control` do not need to preserve or validate it.

Authentication preserves the same measured stock-and-rule composition. Login is a centered sheet no wider than `470px`. Access management uses a `300–390px` key-issue column beside a fluid key register; it stacks at `1050px`. At `700px`, the access masthead becomes a two-row control strip and each register row becomes a labeled vertical record: hide the table header, repeat each field label with `data-label`, use dotted internal dividers, and close each record with a `2px` ink rule. Compact access navigation and row actions must retain at least a `44px` touch target.

The native telemetry client opens centered at `1080 × 760px` with an `880 × 650px` minimum. Its vertical scan is fixed: `82px` identity masthead, `88px` three-cell health strip, flexible work area, then a `34px` privacy/activity footer. The work area uses a `9:11` split with minimum widths of `390px` and `430px`: connection settings scroll independently on the left, while diagnostics sit above a separately ruled activity log on the right. Preserve this source-to-stream reading order; the client is a bridge health instrument, not a telemetry dashboard.

Diagnostic replay expands inside the left connection sheet only when that source is selected. File selection, verification summary, playback speed, high-consequence confirmation, and connect actions stay in the pre-connection flow. Replay transport occupies the same sheet but remains hidden until the bridge is running in replay mode and the server connection is established; it must not imply usable transport before a destination exists.

Overlay layouts are fixed broadcast compositions inside a transparent, pointer-inert viewport. Timing tower, top status, driver focus, battle, flag, and lower-third use viewport-relative offsets and purpose-built dimensions; do not apply the control-panel responsive grid to them.

## Elevation & Depth

The control desk is flat. It uses no ambient box shadows: hierarchy comes from tonal fields, border weight, inverse ink plates, and state stamps. The only inset accents are structural state marks, such as the focused-row orange bar or next-cue top rule.

The native client follows the same flat rule. WPF regions are separated by `1–3px` borders, pale alpha washes, inverse footer ink, and state bars; do not add native drop shadows, raised panels, or floating cards.

Overlays are the exception because they must separate from unpredictable video. Package themes may supply a restrained drop shadow (`0 8px 18px rgba(0,0,0,.48)` in Apex Signal; `0 8px 18px rgba(0,0,0,.4)` in Endurance Blue) and opaque or near-opaque plates.

**The Flat Desk Rule.** Never add floating cards or decorative shadows to the operator surface. Depth belongs to broadcast overlays, where video separation requires it.

## Shapes

Control-panel geometry is square (`0px` radius). Inputs, selects, toggles, row buttons, cue plates, actions, and the emergency clear all use hard corners and visible rules. Decisive state can appear as a stamp, inset stripe, inverse plate, or clipped reveal; avoid pill silhouettes.

Native controls are deliberately authored rather than left to default WPF chrome. Text, password, combo-box, popup, and button templates keep square borders; hover uses the inspection wash, keyboard focus thickens the field rule and adds an external orange focus frame, press/default state thickens the button rule, and disabled controls remain structurally present at `0.48` opacity.

Overlay geometry belongs to the package. The shared layout accepts `--gfx-cut`, but each package may override it with a deliberate broadcast silhouette. Apex Signal uses lacquer-black plates, a `3–4px` racing-red perimeter, and large `18–34px` corner radii; Endurance Blue keeps `0px` corners and uses a colored top rule. Package-specific geometry must remain in `graphic-packages/<id>/theme.css`, not in the global control grammar.

## Components

### Buttons

- **Shape:** square, with `1–2px` borders and condensed uppercase labels.
- **Take:** full-width fluorescent orange field, near-black copy, `48px` minimum height, icon plus text, and an `Enter` keyboard hint.
- **Clear:** full-width carbon ink with stock-colored copy. Emergency clear is taller (`66px` minimum), outlined in orange, and requires a second press within three seconds; confirmation reverses to orange and changes both headline and instruction.
- **Focus:** every interactive control receives a `3px` orange `:focus-visible` outline with `2px` offset.
- **Pending / Disabled:** preserve the control's label position, replace its verb with specific progress copy such as `CHECKING CREDENTIALS…`, `CREATING KEY…`, `REVOKING…`, or `SIGNING OUT…`, disable repeat activation, and use the shipped `0.48` opacity treatment.

### Chips and Status Plates

- Status tags are compact outlined rectangles with uppercase text. Focus fills orange, pit fills yellow, and fastest uses purple text plus the literal `FASTEST` label.
- Flag plates combine the flag name, icon, and relevant fill/pattern. Checkered state uses a checker pattern and text; it is never pattern alone.

### Timing Table

- The sticky header is inverse carbon ink on stock, with compact uppercase labels and right-aligned numeric columns.
- Rows are `56px` high on desktop and `52px` on narrow screens. Hover uses a light inspection wash.
- A focused row becomes an inverse ink plate, gains a `4px` inset orange leading rule, changes the position control to orange, and shows the written `FOCUS` status.
- Best-lap emphasis uses tabular numerals, stronger weight, purple ink, and a written `FASTEST` status.

### Focused-Driver Camera Control

- Keep camera control inside a two-region focused-driver ledger: compact driver identity on the left and a dominant camera-group button bank on the right. Remove duplicate position, gap, and best-lap metrics from this ledger. Each camera-group button directly takes the focused driver's camera; selecting a timing row updates shared driver focus and also takes that driver's camera only when the live controller is ready.
- Write `DISCONNECTED`, `UNAVAILABLE`, `PENDING`, `SENT`, and `REJECTED` delivery states in operator language. Mark selected and observed-active camera groups with written states as well as color. `SENT` confirms SDK delivery, not verified shot execution. Camera buttons are at least `44px` high, wrap into a capped two-row bank on desktop, become an uncapped two-column bank at `700px` and below, and collapse to one column below `340px`.

### Cue Workflow

- Current and next are paired inside a `2px` frame. Current uses an inverse ink plate and the text `CURRENT / ON AIR`; next uses an orange inset top rule and `NEXT CUE`.
- Cue rows combine a number key, semantic icon, slot label, written state, and chevron. Armed uses an inspection fill and inset outline; live uses an inverse plate; live-and-armed adds the orange state rule.
- The inspector is generated from the active package manifest. Fields remain visually consistent across packages and must expose package-safe semantic configuration only.

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
- Apex Signal is a black, white, silver, and racing-red broadcast package. Its tower carries a branded masthead, session strip, labeled columns, twelve `40px` data rows by default, red car-number cells, silver rules, and a red rounded perimeter. Driver focus uses the same red number tab above a deep sponsor-style identity field; race status, battle, and flag plates reuse the lacquer-black material and red outline. Semantic green, yellow, red, and checkered flag colors stay scoped to the flag plate or chip so the surrounding browser-source viewport remains transparent.
- Apex Signal's primary overlay steps are `39px` for the tower wordmark, `30px` for driver identity, `25px` for session titles, `18–24px` for number and data emphasis, and `10–15px` for labels and compact telemetry. Its neutral ramp runs from `#030304` through `#313336`, with silver copy from `#8f9194` through `#f7f7f5`, and uses `#e10613` as the package accent.
- Other slots use similarly direct, labeled facts rather than decorative content. Lower-third and results treatments are not part of the current Apex Signal refresh.
- Overlay visibility is a single `180ms ease-out` opacity transition. Package themes may style plates but must preserve legibility at compressed broadcast sizes and transparent canvas behavior.

## Do's and Don'ts

### Do:

- **Do** keep live timing dominant and the production rail narrow, ordered, and operational.
- **Do** use `1px` rules for measurement, `2px` rules for sections/actions, and `3–4px` orange marks for selected or live state.
- **Do** keep package selection and manifest-defined fields inside the stable Scrutineering Ledger control grammar.
- **Do** use text, icons, borders, patterns, and shape together so color never carries state by itself.
- **Do** reduce motion to effectively zero when `prefers-reduced-motion` is active.
- **Do** keep overlays transparent outside their graphic plates and let package tokens own their client-facing finish.
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

- **Don't** include `/control` in accessibility audits or mobile/responsive review; it is a private desktop-only operator surface.
- **Don't** add a program-video preview; vMix/OBS remains the source of visual confirmation. Keep direct camera-group actions inside the focused-driver ledger with written selection, activity, and delivery states.
- **Don't** turn semantic graphic slots into client-specific styling controls.
- **Don't** use rounded cards, pills, gradients, or ambient shadows on the operator desk.
- **Don't** spend orange on passive decoration; reserve it for focus, armed/live progression, time-critical log marks, and decisive actions.
- **Don't** allow a package theme to alter control-panel layout, control styling, or operator terminology.
- **Don't** animate continuously; use only decisive stamp/slide or opacity state changes around `180–260ms`.
- **Don't** use orange or green as generic authentication status fills; reserve orange for action/selection/confirmation and green for a reinforced success cue.
- **Don't** collapse mobile key records into unlabeled values or require horizontal table scrolling for routine access management.
- **Don't** leave keyboard focus behind when the issue form is replaced by the one-time secret receipt.
- **Don't** let default WPF rounding, gradients, shadows, or typography replace the square Scrutineering Ledger control templates.
- **Don't** turn the native telemetry client into a race-data or program-preview dashboard; it configures the bridge and exposes source-to-stream health, diagnostics, and local activity.
- **Don't** reveal replay transport before the server connection exists or present preflight verification as active playback.
- **Don't** permit diagnostic capture controls during replay or remote replay without an explicit inline confirmation step.
