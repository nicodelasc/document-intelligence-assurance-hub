# Document-to-Action Workbench Redesign

## Status

Approved by Nicholas on 2026-08-28.

## Goal

Turn the Document Intelligence Assurance Hub from an invoice extraction demonstration into an operational document-understanding portfolio piece. The revised application must interpret mixed typed and handwritten evidence then prepare a safe internal action without contacting an external business system.

## Product framing

- Remove the global `Public prototype` badge and normal-product references to `Recorded replay`.
- Keep one quiet truthfulness label when live API access is disabled: `Demo data — no provider call`.
- Never attribute a deterministic demo result to the selected provider or model.
- Keep the public upload consent and 24-hour visibility warning explicit.
- Continue to avoid client names, client data and unsupported production claims.

## Synthetic document scenarios

The fixture catalogue replaces the invoice-only catalogue. Every fixture defines its requested fields, reference data, expected outcome and deterministic action proposal.

### Invoice exception packet

- Document: supplier invoice with a handwritten margin instruction to hold payment and contact the buyer.
- Fields: vendor name, purchase-order number and invoice total.
- Reference result: invoice total conflicts with the purchase-order register.
- Outcome: `Needs review`.
- Prepared action: create an accounts-payable exception review case.
- Policy status: `needs_review`.

### Warehouse receiving sheet

- Document: receiving tally with an untidy handwritten quantity correction.
- Fields: shipment ID, purchase-order number and received quantity.
- Reference result: the corrected quantity matches the expected delivery.
- Outcome: `Clear`.
- Prepared action: stage inventory receipt posting.
- Policy status: `ready`.

### Visitor access request

- Document: access request containing an instruction to prepare a badge but no valid sponsor approval code.
- Fields: visitor name, host and approval code.
- Reference result: required approval evidence is absent.
- Outcome: `Incomplete`.
- Prepared action: create a security review item while badge preparation remains blocked.
- Policy status: `blocked`.

All documents and identities are synthetic. Exact text fields must be programmatically overlaid or otherwise deterministic even when a generated scan texture is used.

## Model catalogue

The model selector is a native grouped dropdown because platform-owned popup geometry is accepted by the existing UX contract.

| Provider | Model ID | Display name | Recommendation |
|---|---|---|---|
| OpenAI | `gpt-5.6-luna` | GPT-5.6 Luna | Recommended for cost |
| OpenAI | `gpt-5.6-terra` | GPT-5.6 Terra | Higher accuracy |
| Anthropic | `claude-haiku-4-5` | Claude Haiku 4.5 | Recommended for cost |
| Anthropic | `claude-sonnet-5` | Claude Sonnet 5 | Higher accuracy |

The server owns model capability and pricing metadata. A request must provide one catalogue model whose provider matches the selected provider. Unknown, mismatched or disabled models fail closed. The chosen model controls adapter construction, persisted telemetry, estimated cost and quota reservation.

Environment variables may restrict the enabled subset but may not introduce model IDs, prices or capability claims. Live keys remain unused until the application and deterministic verification are complete.

## Structured result and action contract

Extraction uses one shared Zod schema with field evidence plus an optional document instruction and an action proposal.

```ts
type ActionType =
  | "create_ap_exception_case"
  | "stage_inventory_receipt"
  | "create_security_review"
  | "create_document_review_task";

interface ActionProposal {
  type: ActionType;
  title: string;
  summary: string;
  payload: Array<{ label: string; value: string }>;
  instructionEvidence: string | null;
  page: number | null;
  risk: "low" | "medium" | "high";
  status: "ready" | "needs_review" | "blocked";
  reason: string;
  stagedAt: string | null;
}
```

The model may propose an action but it never executes it. Deterministic server policy sets the final action status from the verified outcome and trusted fixture metadata. Custom uploads always require review unless required evidence is absent which blocks staging.

`Stage action` creates an internal dry-run event and persists `stagedAt`. It has no tool access and no connector. It must be idempotent and must reject expired, deleted, failed or blocked runs.

## Workbench interaction

### Source rail

- Show three scenario cards followed by a `+ Add your document` tile.
- Activating the tile opens the native file picker.
- After a file is selected show its validation state, two required reviewer-defined fields, an optional third field and the unchanged consent boundary.
- Preserve drag-and-drop as an additional input route.

### Model selection

- Show the currently selected model in the dropdown.
- Group options by provider.
- Add `Recommended` to GPT-5.6 Luna and Claude Haiku 4.5.
- Submit both `provider` and `model` in every run request.
- In demo mode keep the dropdown useful as configuration but show `Demo data — no provider call` beside the run action.

### Visible trace

Map granular server events into three stable display stages:

1. `Understand document` maps validating, storing and extracting.
2. `Verify evidence` maps verifying.
3. `Resolve and prepare action` maps comparing and deciding.

Publishing remains an internal operation and never appears in the Workbench trace. Live announcements use the three display-stage names. The Operations explorer may expose granular timing inside diagnostics.

### Result area

- Show the outcome and prepared action before the field ledger.
- State that the result does not approve a business action.
- Show action type, summary, policy status, payload, evidence and reason.
- Allow staging only when status is `ready` or `needs_review`.
- After staging show a stable success status and disable duplicate activation.

## Operations changes

- Add action status, action type and staged state to run details.
- Add counts for ready actions, review-required actions, blocked actions and staged dry runs.
- Keep raw granular timing inside run diagnostics.
- Remove normal-interface `Recorded replay` and `Public prototype` copy.
- Retain estimated-cost and illustrative-savings labels.

## API changes

- `GET /api/models` returns the server-approved enabled catalogue and defaults.
- `POST /api/runs` requires `provider` and `model` then streams the existing run events plus the action proposal in the completion payload or subsequent run detail.
- `POST /api/runs/[id]/stage-action` idempotently records a dry-run action when policy permits.
- Existing document, metrics, deletion and expiry routes retain their safety rules.

No database migration is required if the action proposal remains inside the existing structured result JSON and staging is represented by a run step. If the current repository shape cannot query action counts efficiently then a migration may add indexed action columns but must preserve existing rows.

## Verification

- Unit tests cover the model catalogue, provider-model matching, per-model pricing, fixture outcomes, action policy and grouped trace mapping.
- Contract tests cover model request validation, both provider adapters, staged-action idempotency and blocked or expired runs.
- Component tests cover the grouped model select, `+` upload tile, three-stage trace and action card.
- Browser tests cover all three fixtures, a custom upload validation failure, keyboard-only model selection, action staging, Operations drill-down and responsive stacking.
- The public deterministic benchmark must aggregate exactly one provider-neutral observation for each fixture. It must produce one `Clear`, one `Needs review` and one `Incomplete` result with zero false-clear results.
- A separate recorded-adapter contract matrix must validate all three fixtures under both provider configurations against the shared result schema without claiming a provider call or provider result.
- API keys must remain absent from the client bundle, HTML, traces and logs.

## Out of scope

- Real payment, inventory, access-control, ERP, RPA or ticketing connectors.
- Automatic action execution.
- Production authentication or private enterprise visibility.
- Client documents, client architecture or measured client savings.
