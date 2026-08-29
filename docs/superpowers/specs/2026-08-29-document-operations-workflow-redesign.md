# Document Operations Workflow Redesign

## Status

Approved section by section by Nicholas on 2026-08-29. The approved choices are:

- Built-in sample documents use the selected AI model when provider processing is enabled.
- The library contains two document families with five variants each.
- Email remains a simulated prepared action with no outbound provider.
- The dashboard is reorganized into Operations and Costs workspaces.
- Previously identified accuracy and presentation fixes are included.

## Goal

Evolve the portfolio application from three deterministic demonstrations into a realistic document-operations workflow. A reviewer must be able to select a business document, observe genuine model extraction and handwriting interpretation, understand why evidence passed or needs attention then prepare a professional next action without implying that an external business system was contacted.

The solution remains synthetic and public-safe. It must not include client data, Samsung data, Kyndryl data, real supplier details or measured savings claims.

## Product language and processing modes

The normal interface must use business language rather than deployment language.

- Replace `Live custom-run model` with `Processing model`.
- Replace `Live-call provider` with `Processing model` or `Model provider` where technical attribution is useful.
- Remove `live provider call`, `live custom run` and similar copy from the normal interface.
- Do not show the keyless warning when AI processing is available.
- When provider processing is unavailable, built-in samples may use deterministic fallback data and show one quiet `Sample results - no AI processing` note.
- Custom uploads remain unavailable in fallback mode because the application must never pretend to interpret an unknown file.

The user chooses a model but does not choose an execution mode. The Workbench derives the provider from the selected model. When the selected provider is enabled, both built-in samples and custom uploads submit through the live provider adapter. When the provider is unavailable, built-in samples submit through the deterministic adapter and custom processing is disabled with a plain recovery message.

Only pressing `Process document` starts a provider request. Browsing ten fixtures, opening previews and comparing expected variants must not consume tokens.

The application must continue to separate selected configuration from confirmed provider dispatch. Operations may show the actual provider and model only after durable dispatch attribution succeeds.

## Document library

### Shared fixture contract

Every synthetic fixture adds these properties to the existing requested fields, reference data, expected outcome and action proposal:

```ts
type DocumentFamily = "supplier_invoice" | "warehouse_goods_receipt";
type VariantClassification = "correct" | "attention" | "incorrect";
type AttentionReason =
  | "manual_instruction"
  | "manual_correction"
  | "unreadable_critical_evidence"
  | "reference_conflict"
  | "none";

interface SyntheticFixture {
  id: string;
  family: DocumentFamily;
  classification: VariantClassification;
  variantLabel: string;
  differenceSummary: string[];
  attentionReason: AttentionReason;
  filename: string;
  title: string;
  description: string;
  requestedFields: Array<{ key: string; label: string }>;
  documentData: Record<string, string | null>;
  referenceData: Record<string, string | null>;
  expectedOutcome: Outcome;
  action: ActionProposal;
}
```

The family and fixture identifier are persisted with each run. Existing rows remain valid with a `legacy` or null family classification.

### Supplier Invoice family

All invoice PDFs contain a supplier header, invoice metadata, bill-to details, a three-line item table, subtotal, tax, total, payment terms and a reviewer-comments area. The extracted field set is:

1. Supplier
2. Invoice number
3. Purchase-order number
4. Invoice date
5. Currency
6. Invoice total
7. Payment terms
8. Reviewer comments

The five variants are:

| Variant | Classification | Evidence difference | Expected outcome |
| --- | --- | --- | --- |
| Clean match | Correct | All requested fields match the purchase-order reference | Clear |
| Buyer hold note | Needs attention | Legible handwritten instruction says to hold payment pending buyer confirmation | Needs review |
| Unreadable approval | Needs attention | Critical handwritten approval text is partially unintelligible and must not be guessed | Incomplete |
| Total mismatch | Incorrect | Invoice total conflicts with the purchase-order reference | Needs review |
| PO and currency mismatch | Incorrect | Purchase-order number and currency both conflict with reference data | Needs review |

### Warehouse Goods Receipt family

All receipt PDFs contain warehouse and carrier metadata, a receiving table, expected and received quantities, damage counts, lot information, receiver sign-off and a comments area. The extracted field set is:

1. Goods-receipt number
2. Delivery-note number
3. Purchase-order number
4. Item code
5. Lot number
6. Expected quantity
7. Received quantity
8. Damaged quantity
9. Receiver comments

The five variants are:

| Variant | Classification | Evidence difference | Expected outcome |
| --- | --- | --- | --- |
| Clean receipt | Correct | Item, lot and quantities match the expected delivery | Clear |
| Quantity correction | Needs attention | Legible handwritten quantity correction matches the physical count but requires acknowledgement | Needs review |
| Unreadable damage note | Needs attention | Critical handwritten quarantine or damage wording is partially unintelligible | Incomplete |
| Quantity mismatch | Incorrect | Received quantity conflicts with the delivery reference | Needs review |
| Item and lot mismatch | Incorrect | Item code and lot number conflict with the purchase-order reference | Needs review |

The ten-fixture expected-outcome population is two Clear, six Needs review and two Incomplete results. A deterministic false-clear count must remain zero.

## Realistic PDF construction

Every final sample is a one-page A4 or Letter-sized PDF with a restrained enterprise document style. It includes realistic whitespace, aligned tables, identifiers, dates, totals, comments and approval areas. It must remain visibly synthetic without placing a large watermark over evidence.

Typed content remains native PDF text. Handwritten evidence is generated as a raster layer using a bundled open-licensed handwriting font with varied baseline, rotation, ink opacity and spacing. The raster layer prevents the model from receiving the handwritten note as selectable PDF text.

Legible handwriting must be visually readable to a human reviewer. Intentionally unclear evidence may use overlapping strokes, partial occlusion and uneven pen pressure but the surrounding label must remain readable. The unclear samples must instruct the model contract to return missing or unsupported evidence rather than guess.

The generation pipeline must be deterministic. Font assets and their licence must be committed. Each generated PDF is rendered to PNG and visually inspected for clipping, overlap, unreadable typed content and broken page boundaries.

## Workbench information architecture

### Source selection

The source rail has two family tabs:

- Supplier Invoices
- Warehouse Goods Receipts

Each tab shows five variant cards plus the existing `+ Add your document` tile. The selected card uses a classification border and badge:

- Green: Correct
- Amber: Needs attention
- Red: Incorrect

The selected fixture opens a `What changed` panel beside the preview. It lists the expected differences in concise language but does not alter or annotate the evidence inside the document itself.

### Preview and processing controls

The document preview shows the actual PDF rather than a simplified reconstructed card. It offers `Open full document` and preserves the local-only custom-upload preview boundary.

The model selector is labelled `Processing model`. Recommended labels remain on GPT-5.6 Luna and Claude Haiku 4.5. Pressing `Process document` starts one provider attempt with at most one same-provider retry under the existing retry policy.

### Assurance result

The visible trace remains:

1. Understand document
2. Verify evidence
3. Resolve and prepare action

The result area shows these items in order:

1. Business-facing outcome and short explanation
2. Differences between document evidence and reference data
3. Prepared workflow action
4. Field evidence ledger
5. Activity timeline

The model proposes extraction and action content through the shared schema. The server verifies evidence against native text or local OCR, normalizes values, compares reference values and decides the final outcome. Field verification remains deterministic and parallel. No field verifier becomes a second AI call.

For custom uploads any missing requested field produces an incomplete-evidence result. A partial result must never be labelled evidence-consistent.

## Simulated workflow actions

Workflow buttons create durable simulated events. They never call an ERP, inventory system, payment system, email provider or ticketing platform.

```ts
type WorkflowActionType =
  | "approve_and_stage"
  | "mark_for_later_review"
  | "assign_review"
  | "request_clarification"
  | "request_clearer_document"
  | "prepare_email"
  | "replace_document"
  | "retry_processing"
  | "download_summary";

type WorkflowEventStatus = "prepared" | "staged" | "simulated";

interface WorkflowEvent {
  id: string;
  runId: string;
  action: WorkflowActionType;
  recipientRole: string | null;
  status: WorkflowEventStatus;
  createdAt: string;
}
```

Recipient selection uses fixture-specific synthetic roles such as Accounts Payable Analyst, Buyer, Supplier Contact and Warehouse Lead. Custom uploads use generic roles such as Document Owner and Reviewer. The application does not request or store a real email address.

### Ready actions

Primary action: `Approve and stage`.

Secondary actions:

- Prepare email copy
- Download review summary
- Mark for later review

### Needs-attention actions

Primary action: `Assign for review`.

Secondary actions:

- Request clarification
- Prepare email to the selected role
- Replace document and reprocess
- Download discrepancy summary

### Incomplete or unreadable actions

Primary action: `Request a clearer document`.

Secondary actions:

- Prepare replacement-request email
- Assign manual review
- Upload replacement
- Reprocess

### Processing-error actions

Primary action: `Retry processing`.

Secondary actions:

- Review the safe diagnostic
- Choose another model manually
- Download the error summary

The email action opens a preview with a deterministic professional subject and body generated from public-safe run evidence. The user may copy the text. The preview and activity timeline state `Prepared only - not sent`.

`Approve and stage` replaces the ambiguous `Submit` language. It persists internal preparation only. Existing stage-action behavior remains available through a compatibility route while the interface moves to the workflow-event endpoint.

## Workflow persistence and routes

Add a `workflow_events` table and persist `document_family` plus `fixture_id` on each run. Migration `0008_document_workflow.sql` is idempotent and preserves existing rows.

Add these interfaces:

| Method | Route | Behavior |
| --- | --- | --- |
| `POST` | `/api/runs/[id]/workflow-actions` | Validate the browser-held run capability, outcome policy and action allowlist then create one idempotent simulated event |
| `GET` | `/api/runs/[id]` | Include active workflow events in public-safe run detail |
| `POST` | `/api/runs/[id]/stage-action` | Retain as a compatibility mapping to `approve_and_stage` |

Every workflow mutation requires the existing browser-held capability. Expired, deleted, failed or policy-blocked runs reject actions that imply progression. Retry processing creates a new run rather than mutating the evidence of the previous run.

Prepared email content is generated on demand and is not stored in Neon. Only the selected synthetic recipient role, action type, status and timestamp are retained.

## Operations and Costs layout

The four summary metrics remain at the top. Below them the desktop layout uses a two-column workspace. Operations occupies approximately two-thirds of the width and Costs occupies approximately one-third. Costs stacks after Operations on mobile.

### Operations workspace

The left workspace contains:

- Workflow status: ready, needs attention, incomplete and processing errors
- Processing performance: completion rate, p50 latency, p95 latency, retries and failure rate
- Document quality: exact match, missing-field recall, unreadable-field detection and false-clear count
- Document lifecycle: active documents, upcoming expiry buckets and cleanup status
- Run explorer: document family, variant, model, outcome, workflow action and processing time
- Run detail: document preview, extraction, evidence, differences, comments, activity timeline and safe diagnostics

The run explorer filter is labelled `Processing model`. Provider filtering uses confirmed provider dispatch only. Technical metadata may state the actual provider and model but must not use `live-call` language.

The expiry timeline uses real active-detail buckets that fit a less-than-24-hour policy:

- Less than 1 hour
- 1 to 6 hours
- 6 to 24 hours

Aggregate p50, p95, retry count and average step duration values already returned by the metrics API must become visible.

### Costs workspace

The right workspace contains:

- API spend today and month to date
- Average cost per confirmed model run
- Cost and run count by model
- Average cost by supplier invoice and warehouse goods receipt
- Daily budget used, reserved and remaining
- The existing illustrative resource scenario calculator

Recorded fallback runs contribute no provider tokens and must not dilute average model cost. Average cost uses confirmed completed model runs with trustworthy usage. A dispatched failed call may consume conservative budget but remains distinguishable from a completed-run API-cost estimate.

All monetary figures retain their dated estimated-cost or illustrative-scenario labels. The resource calculator never claims measured savings.

## Reference quality suite

Rename `Synthetic benchmark quality` to `Reference quality suite`. The suite contains exactly ten provider-neutral deterministic fixture observations with one observation per approved variant.

The suite reports:

- Exact-match rate
- Missing-field recall
- Evaluator agreement
- Unreadable-critical-evidence detection
- False-clear count
- Fixture count by family and classification

The suite is a contract baseline rather than a provider-accuracy claim. Real sample runs are shown separately in the run explorer with confirmed model attribution.

## Cost controls

The existing US$5 default global daily budget, per-browser limits, provider-specific routing and one-retry policy remain. Model browsing does not reserve budget. A reservation is created only after the reviewer starts a run.

Operations exposes the safe daily budget amount, actual settled spend, pending reservations and remaining amount. It never exposes credentials or anonymous rate-limit bucket identifiers.

No automatic model fallback is allowed. A reviewer may manually choose another model after a safe error.

## Security and retention

- API keys remain server-side and never enter HTML, client bundles, public traces or logs.
- Model availability discloses only safe enabled or unavailable state and never credential details.
- Document text remains untrusted data and cannot alter the system instruction.
- Models receive no tools or external actions.
- Custom documents retain the existing explicit consent boundary.
- Active files remain accessible through same-origin application routes for 23 hours and 55 minutes or until early deletion.
- Prepared workflow events are public with the run detail until expiry.
- Run deletion removes detailed evidence, document access and workflow-event visibility.
- Aggregate operational and cost totals survive detailed-data cleanup without retaining raw document content.

## Testing and acceptance

### Unit and component coverage

- Validate the ten-fixture matrix, family counts, classifications and expected outcomes.
- Verify any missing custom field produces incomplete evidence.
- Verify workflow actions allowed for each outcome and blocked for expired, deleted or failed runs.
- Verify email preview templates state `Prepared only - not sent` and contain no real addresses.
- Verify reference-suite calculations across ten observations with zero false clears.
- Verify live-only average cost and family cost calculations exclude recorded fallback runs.
- Verify truthful expiry bucket calculations.
- Verify family tabs, variant borders, differences panel, workflow controls and Operations/Costs responsive stacking.

### PDF verification

- Generate all ten PDFs deterministically.
- Confirm expected PDF page count, filename and extractable typed fields.
- Confirm handwriting is rasterized and absent from extracted native PDF text.
- Render every PDF to PNG and inspect alignment, table borders, comments, handwriting and footers.
- Confirm no clipping, overlapping typed content, broken glyphs or accidental real-world data.

### Browser acceptance

- Process one correct, one needs-attention and one incorrect fixture from each family through deterministic fallback mode.
- In enabled mode process at least one legible-handwriting case and one unclear-handwriting case through each recommended provider.
- Smoke-test one run through each non-recommended model so every visible model route is exercised.
- Confirm no model request begins before the user presses `Process document`.
- Confirm cost, token, model and provider attribution appears only after confirmed dispatch.
- Confirm every workflow button creates the expected simulated timeline event without an external call.
- Confirm custom partial-missing evidence is not labelled consistent.
- Confirm document expiry and early deletion remove active detail access.

Do not claim live-model acceptance until all four configured model routes pass their smoke tests on the production deployment.

## Out of scope

- Sending real email
- Accepting or storing real recipient addresses
- ERP, payment, inventory, supplier, ticketing or RPA integration
- Automatic approval or rejection
- Automatic provider switching
- Production authentication or tenant isolation
- Client documents, internal client prompts or measured client savings
