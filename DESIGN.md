---
version: alpha
name: "Document Intelligence Assurance Hub"
description: "An evidence-desk interface for reviewing AI document extraction and operating a public-safe portfolio demonstration."
colors:
  canvas: "#F8F9FB"
  surface: "#FFFFFF"
  ink: "#101828"
  muted: "#526071"
  rule: "#D7DCE3"
  primary: "#155EEF"
  primary-soft: "#EAF1FF"
  success: "#168A52"
  warning: "#A14F00"
  danger: "#C62934"
  focus: "#155EEF"
typography:
  display:
    fontFamily: "Manrope, Arial, sans-serif"
  sans:
    fontFamily: "Inter, Arial, sans-serif"
  mono:
    fontFamily: "IBM Plex Mono, Consolas, monospace"
rounded:
  DEFAULT: "0.375rem"
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.625rem"
spacing:
  unit: "0.25rem"
  panel-gap: "1rem"
  page-gutter: "1.5rem"
  page-max: "120rem"
components:
  button: {}
  input: {}
  panel: {}
  table: {}
  trace: {}
  dialog: {}
---

# Document Intelligence Assurance Hub Design System

## Overview

### Creative North Star

The interface borrows from an evidence review desk: ruled ledgers, clipped document sheets and audit annotations arranged with calm operational precision. It should feel credible in a regional operations review without borrowing a client brand.

### Product context and register

- **Audience and primary job:** A non-technical headquarters interviewer should be able to run a sample, understand the assurance trace and inspect a prepared action with its evidence.
- **Target market and evidence:** The demonstration is designed for a Singapore regional role described in the approved product specification. It does not assume Samsung internal systems or users.
- **Locale and language policy:** English UI with `en-SG` number and currency formatting. Technical timestamps display an explicit timezone.
- **Usage scene:** Small-laptop and desktop review first with mobile stacking for link sharing.
- **Register:** Product interface on both routes.
- **Memorable signature:** A cobalt evidence rail links live workflow stages to extracted field evidence.
- **Restraint:** Tables, forms and warnings remain familiar and literal.
- **Anti-references:** No sci-fi command center, neon AI glow, generic bento dashboard, consumer chatbot or faux corporate branding.
- **Token ownership/runtime mapping:** Runtime CSS variables in `src/app/globals.css` are canonical. This file mirrors accepted values and explains intent. `premium-ui.json` and the browser screenshot ledger are the drift gates.

The accepted visual references are `docs/design/concepts/workbench-concept.png` and `docs/design/concepts/operations-concept.png`.

## Colors

`canvas` is a true cool near-white while `surface` is white. `ink`, `muted` and `rule` create the document-review hierarchy. Cobalt is the sole expressive accent. Green, amber and red are semantic only. Focus always uses a visible cobalt outline with sufficient contrast.

## Typography

Manrope carries route headings and the product name. Inter owns controls, tables and explanatory text. IBM Plex Mono is limited to run identifiers, durations, token counts and prompt versions. Sentence case is the default. Numeric telemetry uses tabular figures.

## Layout

Workbench uses a three-region evidence desk: document library, document canvas and assurance rail. The library exposes Supplier invoices and Warehouse goods receipts as a real two-tab family set with five variants in each family. Variant tiles carry Correct, Needs attention or Incorrect text plus a supporting icon and semantic edge color. `+ Add your document` follows the variants and invokes the existing native file picker. The canvas embeds the selected actual PDF and keeps a stable frame beside its `What changed` annotation. The assurance rail groups the raw workflow into three visible stages then presents the prepared action before the evidence ledger. Operations starts with four summary metrics then uses a durable two-thirds Operations workspace and one-third Costs workspace. Operations contains workflow status, processing performance, the Reference quality suite, document lifecycle and the explorer with its detail inspector. Costs contains settled API spend estimates, completed-run cost estimates, confirmed provider usage, model and document-family breakdowns, the daily model budget and the illustrative resource calculator. Panels use thin rules instead of nested cards. At widths below 1024 px Workbench regions stack as library, preview and trace. At 960 px and below the Operations workspace stacks before the Costs workspace. At narrow widths family tabs and variants stack without horizontal page overflow while the PDF frame keeps a stable viewport. Tables retain explicit horizontal scrolling and values are never silently hidden.

## Elevation & Depth

Hierarchy comes from borders, tonal surfaces and sticky rails. Shadows are reserved for dialogs and a dragged upload state. Static panels do not float.

## Shapes

Controls use the `md` radius. Document previews may use a clipped upper corner. Status dots are circular because they indicate state. Large pill containers and fully rounded cards are prohibited.

## Components

### Foundational visual states

Every interactive component defines default, hover, focus-visible, pressed, disabled, busy and error states. Selected rows use a cobalt inline rule and a light blue background. Loading regions reserve their final geometry.

### Buttons and actions

Buttons combine emphasis and intent. Cobalt solid is the single primary action per region. Neutral outline supports comparison and navigation. Amber is used for recoverable purge warnings. Red is limited to `Delete now` confirmation. Busy labels preserve button width.

### Navigation and data display

The sticky header contains the product name and the two route links. On Workbench only it also carries the cobalt `How it works` button at the far right so first-time guidance stays visible before the review begins. The trigger remains in the first header row on mobile while route navigation occupies the row below. Tables use semantic markup, sticky headers where helpful and an explicit horizontal overflow cue on narrow screens. Recharts uses the semantic palette with text summaries adjacent to every chart.

### Forms and overlays

Forms use visible labels, app-owned validation, `noValidate` and first-error focus. The canonical model control is a grouped native select because its platform-owned popup geometry is accepted. The `+ Add your document` tile is a button that invokes the existing native file input while preserving drag-and-drop, validation and consent. Destructive actions use an accessible app-owned dialog with Cancel initially focused.

### Workbench guidance and terminal review

The Workbench header owns one bold cobalt `How it works` trigger with a help icon. It first opens a concise purpose overview then starts a five-step guided spotlight for the Document library, Processing model, Process document control, Assurance trace and Decision and next steps. The overview initially focuses `Start guided tour` and each spotlight step moves focus to its callout heading. The page stays shaded and inert throughout. A cobalt outline and static directional arrow identify the current target without turning the underlying control into part of the modal. Desktop callouts choose a collision-safe position with 16 px viewport clearance. At 720 px and below the callout becomes a safe-area-aware bottom card while the target scrolls into the upper page. The header changes to two rows at 900 px and below so its trigger does not create tablet overflow. Target and callout resize observations keep the spotlight aligned as results load. Forced-colors mode uses system Highlight and CanvasText colors for the outline, shade and arrow. Back, Next, Finish, Exit guided tour and Escape preserve modal focus behavior then restore focus to the header trigger. Leaving Workbench closes guidance so returning starts from a closed state. On terminal success the assurance trace becomes a compact disclosure with the completed-stage count and total duration when available. Its named detail region exposes the same three stages on demand. A failed trace stays expanded so safe diagnostics remain visible. The terminal result is one `Decision and next steps` panel: verified outcome, decision brief, evidence differences and workflow controls in that order. The evidence ledger and activity timeline remain separate panels below it.

### Workbench action states

The primary Workbench mutation is `Process document`. Browsing a family or selecting a variant changes the actual PDF preview without submitting a run. The visible trace is `Understand document`, `Verify evidence` and `Resolve and prepare action`. Publishing remains a server concern and is not shown or announced as a user task. Grouped stage announcements are deduplicated. A terminal failure marks the active visible group as needing attention. Prepared actions use pessimistic staging: the button becomes busy without changing the proposal then success replaces it with the server-returned staged state. Ready and review-required actions may stage while blocked actions may not. The browser sends the private run capability in a request header and never a URL. Duplicate clicks are inert while pending. Failure preserves the proposal and exposes a safe retry. Library controls and the native grouped model select lock during validation and execution. Completion removes cancellation before prepared-action detail loading begins. That loading state and its recoverable failure remain distinct from an absent action. Recorded fixtures show `Sample results - no AI processing` only when the selected provider route is unavailable. Available recorded routes show no equivalent note and fixture results are never attributed to the selected model. An unavailable custom route shows `Processing unavailable for this model` and disables processing. A custom `not_found` result uses `Incomplete evidence - one or more requested fields were not found` and never displays Evidence-consistent. For irrelevant or uncertain custom documents the server keeps the `not_found` outcome, replaces any provider proposal with the bounded safe decision brief and limits the panel to `Replace document and reprocess` plus `Download review summary`. Operations uses `No AI processing` for every non-dispatched run. Configured provider and model choices never appear as execution attribution. Confirmed tokens and provider splits count dispatched runs only.

### Iconography

Lucide outline icons use a consistent 1.75 px stroke. Icons support labels and never replace unfamiliar action text.

### Motion

The evidence rail advances with a 180 ms state transition. Each guided-tour step uses one 180 ms opacity and 8 px settle as the callout changes. The spotlight and arrow never pulse, bounce or glow. Other motion is limited to purposeful hover, selection and dialog feedback. Reduced-motion mode removes transforms, uses near-instant opacity changes and changes guided target scrolling from smooth to immediate.

### Content and data visualization

Copy describes evidence and demonstration behavior directly. It never calls an extraction a payment approval. Cost and savings figures are labeled estimates or illustrative scenarios. Charts have adjacent numeric summaries and accessible labels.

## Do's and Don'ts

- **Do:** Let documents, evidence and trace timing carry the visual identity.
- **Do:** Keep status language consistent between Workbench, Operations and API results.
- **Don't:** introduce a client logo, client dataset or unsupported production metric.
- **Don't:** hide a warning, field value or action behind color or hover alone.

