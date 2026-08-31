# Procurement Document Exception Triage

## Status

Approved by Nicholas on 2026-08-31 after a business-purpose audit prompted by manager feedback. This specification narrows the existing demonstration from a collection of document-processing tools into one procurement review problem.

## Problem statement

Finance and warehouse teams manually review supplier invoices and goods receipts before payment or inventory posting. Typed fields, handwritten notes and reference mismatches can be missed. The Hub extracts evidence, compares it with trusted synthetic records, identifies exceptions and prepares a controlled human handoff before downstream posting.

The application does not approve payment, post inventory, send email or update an ERP. It prepares evidence and a next step for a responsible employee.

## Product scope

The product is a procurement document exception-triage demonstration with two checkpoints in one process:

1. Supplier invoices are assessed before a finance posting decision.
2. Warehouse goods receipts are assessed before an inventory posting decision.

The application must not call this a three-way match because the invoice and warehouse fixtures are not linked as one transaction.

The outcome vocabulary is:

- `Clear` is presented as `Ready for posting decision`.
- `Needs review` is presented as `Exception review required`.
- `Incomplete` is presented as `Awaiting readable evidence`.
- Custom-upload evidence labels remain evidence-only and never imply business approval.

## Workbench

The first viewport must state the problem before exposing processing controls:

- Heading: `Review incoming procurement documents`.
- Supporting copy: `Verify supplier invoices and goods receipts before finance or inventory handoff.`
- Library heading: `1. Select a procurement document`.
- Primary action: `Assess for exceptions`.
- Terminal panel: `Exception triage decision`.
- Terminal workflow section: `Prepared next step`.

The three visible trace stages remain compact and observable:

1. Understand document
2. Verify evidence
3. Triage exception and prepare handoff

The trace remains collapsible after successful processing and expanded after failure.

The `How it works` tour must lead with the manual-review problem. It may use accurate terms such as agentic workflow, multimodal document understanding, evaluator safeguards and guardrailed handoff. It must also state that the documents and references are synthetic.

## Outcome-specific actions

The interface exposes only actions that support the stated process:

| Result | Controls |
| --- | --- |
| Clear or Evidence-consistent | `Prepare posting handoff` |
| Needs review or Conflict | `Assign exception review` and `Draft clarification request` |
| Incomplete or Not found | `Request clearer evidence`, `Assign manual review` and `Replace document` |
| Failed | `Retry processing` |
| Irrelevant or uncertain custom document | `Replace with a supported procurement document` |

`Draft clarification request` uses the existing prepared-email preview. It stays `Prepared only - not sent` and accepts only a server-approved synthetic role.

The historical action identifiers and database enum remain compatible. `approve_and_stage` is retained as an internal identifier but new events use status `prepared`. No new event may claim that posting occurred.

Download-summary and mark-for-later controls are removed from the Workbench. Existing historical events remain readable in Operations.

## Operations

Operations becomes a business-first review console while retaining technical traceability:

- Page heading: `Procurement review operations`.
- Supporting copy explains invoice and goods-receipt triage before downstream handoff.
- Summary labels are `Documents triaged`, `Completion rate`, `Exception rate` and `Failure rate`.
- The `Procurement review queue` appears before processing-performance and assurance panels.
- Queue columns lead with document reference, document type, review decision, exception, prepared next step and received time.
- Run ID, model, token, latency, expiry and safe diagnostics remain in the selected record inspector.
- `Workflow status` becomes `Triage status`.
- Status labels become `Ready for posting decision`, `Exception review required`, `Awaiting readable evidence` and `Processing errors`.
- `Latest simulated workflow activity` becomes `Prepared case handoffs`.
- `Document lifecycle` becomes `Public demo retention`.
- `Run detail` becomes `Review record and technical trace`.

The Operations tour follows the business journey: triage overview, review queue, workflow health, assurance safeguards then cost governance.

## Approved handwriting fixtures

Replace the two generated placeholder PDFs with the approved reviewer-written files:

- `C:/Users/nicho/Downloads/invoice-unreadable-approval-blank-comments.pdf`
- `C:/Users/nicho/Downloads/warehouse-unreadable-damage-note-blank-comments.pdf`

The canonical public filenames remain:

- `invoice-unreadable-approval.pdf`
- `warehouse-unreadable-damage-note.pdf`

Store stable approved source copies under `assets/sample-overrides/`. The sample generator must copy these sources instead of overwriting them with generated placeholder handwriting. Commit matching raster previews and verify the rendered page dimensions.

The two files must never produce a clear result:

- If visual evidence is decoded and conflicts with the trusted reference then the outcome is `Needs review`.
- If the evidence cannot be decoded confidently then the outcome is `Incomplete`.

## Visual grounding

The current native-text shortcut cannot skip visual analysis for built-in fixtures that contain handwriting. Extend the document-grounding contract with an explicit visual mode. In that mode a text-native PDF page is also rendered for bounded local OCR then native text and OCR text are merged for page-scoped evidence checks.

Live synthetic runs with handwritten evidence use visual mode. Recorded synthetic runs keep their deterministic result and do not invoke OCR or a provider. Custom uploads keep the current bounded text-or-scan path unless a later approved design introduces an explicit visual-grounding choice.

Visual grounding remains local, cancellable, page-limited and fail-closed. It must not introduce a second provider call.

## Truth boundary

Use this meaning consistently across both routes and their tours:

> All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed.

No provider key or paid model call is required for this release. Configured model choice remains separate from confirmed provider dispatch.

## Acceptance criteria

- The first Workbench viewport explains the procurement problem without requiring the tour.
- The Workbench exposes only the scoped actions listed above.
- New posting-handoff events are labelled prepared and never staged.
- Operations leads with a business review queue and keeps technical detail in the inspector.
- Both route tours retain five keyboard-accessible steps, focus restoration, compact mobile geometry and reduced-motion behavior.
- The approved PDFs and matching PNGs replace the two placeholder assets under their canonical filenames.
- Regenerating samples preserves the approved PDF overrides.
- Visual grounding processes text-native PDF pages when explicit visual mode is selected.
- The two unreadable fixtures remain fail-closed with zero false clears.
- Recorded mode makes no provider call.
- Desktop and 390 px mobile layouts have no horizontal page overflow.
- Unit, component, contract, accessibility, browser, build, premium, dependency and public-surface checks pass before deployment.
- The pre-change commit remains available as a named rollback point.
