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
  connected-green: "#177344"
  disconnected-ink: "#2b2523"
  disconnected-copy: "#f2c5b8"
  caution-yellow: "#f1c933"
  caution-ink: "#17150a"
  stop-red: "#c53127"
  fastest-purple: "#7e3bd1"
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

**Key Characteristics:**

- Off-white technical stock, near-black ink, muted gray-green inspection fields, and fluorescent orange state stamps.
- Condensed industrial headings paired with highly legible sans-serif body copy and tabular race data.
- Square controls, dense rules, and visible state labels; no ornamental cards or ambient animation.
- A timing-first desktop composition that collapses into a readable single-column operating sequence.
- Transparent overlays built from stable layouts and runtime package tokens.

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

### Neutral

- **Technical Stock** (`#f4f1e8`): the global canvas and pale working surfaces.
- **Carbon Ink** (`#15191c`): primary copy, section rules, selected rows, dark actions, and inverse table headers.
- **Ledger Muted** (`#626b68`): descriptions, secondary data, and field labels.
- **Paper Rule** (`rgba(21, 25, 28, 0.19)`): quiet row dividers and dotted log rules.
- **Disconnected Ink / Copy** (`#2b2523` / `#f2c5b8`): explicit feed-failure plate and supporting diagnostic text.

**The Approval Stamp Rule.** Orange marks a state change or decisive action; it is not a general decoration or large ambient background.

**The Redundancy Rule.** Never communicate live, preview, focused, disconnected, fastest, pit, or flag state through color alone.

## Typography

**Display Font:** Barlow Condensed (sans-serif fallback)

**Body Font:** Source Sans 3 (sans-serif fallback)
**Overlay Package Fonts:** supplied through `--gfx-font-display` and `--gfx-font-data`; current packages use condensed system display faces and Segoe UI data text.

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

At `1050px`, masthead cells form two columns, timing and production become vertical, and the rail forms two columns. At `700px`, the page becomes one column, the table hides last lap, best lap, and status, secondary driver/team copy is removed, and inspector fields stack. Preserve timing position, number, driver, and interval as the minimum mobile race-reading set.

Overlay layouts are fixed broadcast compositions inside a transparent, pointer-inert viewport. Timing tower, top status, driver focus, battle, flag, and lower-third use viewport-relative offsets and purpose-built dimensions; do not apply the control-panel responsive grid to them.

## Elevation & Depth

The control desk is flat. It uses no ambient box shadows: hierarchy comes from tonal fields, border weight, inverse ink plates, and state stamps. The only inset accents are structural state marks, such as the focused-row orange bar or next-cue top rule.

Overlays are the exception because they must separate from unpredictable video. Package themes may supply a restrained drop shadow (`0 8px 16px rgba(0,0,0,.35)` in Apex Signal; `0 8px 18px rgba(0,0,0,.4)` in Endurance Blue) and opaque or near-opaque plates.

**The Flat Desk Rule.** Never add floating cards or decorative shadows to the operator surface. Depth belongs to broadcast overlays, where video separation requires it.

## Shapes

Control-panel geometry is square (`0px` radius). Inputs, selects, toggles, row buttons, cue plates, actions, and the emergency clear all use hard corners and visible rules. Decisive state can appear as a stamp, inset stripe, inverse plate, or clipped reveal; avoid pill silhouettes.

Overlay geometry belongs to the package. The shared layout accepts `--gfx-cut`: Apex Signal clips two corners by `10px`, while Endurance Blue keeps `0px` corners and uses a colored top rule. Package-specific geometry must remain in `graphic-packages/<id>/theme.css`, not in the global control grammar.

## Components

### Buttons

- **Shape:** square, with `1–2px` borders and condensed uppercase labels.
- **Take:** full-width fluorescent orange field, near-black copy, `48px` minimum height, icon plus text, and an `Enter` keyboard hint.
- **Clear:** full-width carbon ink with stock-colored copy. Emergency clear is taller (`66px` minimum), outlined in orange, and requires a second press within three seconds; confirmation reverses to orange and changes both headline and instruction.
- **Focus:** every interactive control receives a `3px` orange `:focus-visible` outline with `2px` offset.

### Chips and Status Plates

- Status tags are compact outlined rectangles with uppercase text. Focus fills orange, pit fills yellow, and fastest uses purple text plus the literal `FASTEST` label.
- Flag plates combine the flag name, icon, and relevant fill/pattern. Checkered state uses a checker pattern and text; it is never pattern alone.

### Timing Table

- The sticky header is inverse carbon ink on stock, with compact uppercase labels and right-aligned numeric columns.
- Rows are `56px` high on desktop and `52px` on narrow screens. Hover uses a light inspection wash.
- A focused row becomes an inverse ink plate, gains a `4px` inset orange leading rule, changes the position control to orange, and shows the written `FOCUS` status.
- Best-lap emphasis uses tabular numerals, stronger weight, purple ink, and a written `FASTEST` status.

### Cue Workflow

- Current and next are paired inside a `2px` frame. Current uses an inverse ink plate and the text `CURRENT / ON AIR`; next uses an orange inset top rule and `NEXT CUE`.
- Cue rows combine a number key, semantic icon, slot label, written state, and chevron. Armed uses an inspection fill and inset outline; live uses an inverse plate; live-and-armed adds the orange state rule.
- The inspector is generated from the active package manifest. Fields remain visually consistent across packages and must expose package-safe semantic configuration only.

### Inputs and Toggles

- Inputs and selects are transparent, `34px` high, square, and bounded by a `1px` ink rule. Labels sit above in small uppercase display type.
- The toggle is a square `42 × 24px` track with a `16px` block thumb. Checked state moves the thumb `18px` and turns it orange.

### Overlay Plates

- Shared overlay components position and structure content; package themes own `--gfx-ink`, `--gfx-surface`, `--gfx-surface-soft`, `--gfx-accent`, `--gfx-muted`, `--gfx-font-display`, `--gfx-font-data`, and `--gfx-cut`.
- The timing tower uses `42px` title and `45px` data rows. Driver focus uses a large car-number block, identity, position, and metric. Other slots use similarly direct, labeled facts rather than decorative content.
- Overlay visibility is a single `180ms ease-out` opacity transition. Package themes may style plates but must preserve legibility at compressed broadcast sizes and transparent canvas behavior.

## Do's and Don'ts

### Do:

- **Do** keep live timing dominant and the production rail narrow, ordered, and operational.
- **Do** use `1px` rules for measurement, `2px` rules for sections/actions, and `3–4px` orange marks for selected or live state.
- **Do** keep package selection and manifest-defined fields inside the stable Scrutineering Ledger control grammar.
- **Do** use text, icons, borders, patterns, and shape together so color never carries state by itself.
- **Do** reduce motion to effectively zero when `prefers-reduced-motion` is active.
- **Do** keep overlays transparent outside their graphic plates and let package tokens own their client-facing finish.

### Don't:

- **Don't** add a program-video preview or camera controls to the control panel; the shipped workflow stops at the selected-driver focus boundary.
- **Don't** turn semantic graphic slots into client-specific styling controls.
- **Don't** use rounded cards, pills, gradients, or ambient shadows on the operator desk.
- **Don't** spend orange on passive decoration; reserve it for focus, armed/live progression, time-critical log marks, and decisive actions.
- **Don't** allow a package theme to alter control-panel layout, control styling, or operator terminology.
- **Don't** animate continuously; use only decisive stamp/slide or opacity state changes around `180–260ms`.
