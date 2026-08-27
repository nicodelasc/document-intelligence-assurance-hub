---
version: alpha
name: "Document Intelligence Assurance Hub"
description: "An evidence-desk interface for reviewing AI document extraction and operating a public-safe prototype."
colors:
  canvas: "#F8F9FB"
  surface: "#FFFFFF"
  ink: "#101828"
  muted: "#526071"
  rule: "#D7DCE3"
  primary: "#155EEF"
  primary-soft: "#EAF1FF"
  success: "#168A52"
  warning: "#B35B00"
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

- **Audience and primary job:** A non-technical headquarters interviewer should be able to run a sample, understand the assurance trace and inspect how the prototype is monitored.
- **Target market and evidence:** The prototype is designed for a Singapore regional role described in the approved product specification. It does not assume Samsung internal systems or users.
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

Workbench uses a three-region evidence desk: source rail, document canvas and assurance rail. Operations uses open metric bands followed by a run ledger and detail inspector. Panels use thin rules instead of nested cards. At widths below 1024 px regions stack in task order. At narrow widths tables retain horizontal scrolling and values are never silently hidden.

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

The header contains the product name and the two route links only. Tables use semantic markup, sticky headers where helpful and an explicit horizontal overflow cue on narrow screens. Recharts uses the semantic palette with text summaries adjacent to every chart.

### Forms and overlays

Forms use visible labels, app-owned validation, `noValidate` and first-error focus. The upload control always exposes a visible file-picker action. Destructive actions use an accessible app-owned dialog with Cancel initially focused.

### Iconography

Lucide outline icons use a consistent 1.75 px stroke. Icons support labels and never replace unfamiliar action text.

### Motion

The evidence rail advances with a 180 ms state transition. Other motion is limited to purposeful hover, selection and dialog feedback. Reduced-motion mode removes transforms and uses near-instant opacity changes.

### Content and data visualization

Copy describes evidence and prototype behavior directly. It never calls an extraction a payment approval. Cost and savings figures are labeled estimates or illustrative scenarios. Charts have adjacent numeric summaries and accessible labels.

## Do's and Don'ts

- **Do:** Let documents, evidence and trace timing carry the visual identity.
- **Do:** Keep status language consistent between Workbench, Operations and API results.
- **Don't:** introduce a client logo, client dataset or unsupported production metric.
- **Don't:** hide a warning, field value or action behind color or hover alone.

