# Document Library and AI Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ten realistic invoice and warehouse fixtures then process the selected built-in PDF through the chosen AI model when that provider is available.

**Architecture:** Fixture metadata becomes the single source for PDFs, deterministic fallback responses and the reference suite. A safe server capability response tells the Workbench whether the selected provider can process a document without exposing credentials. Built-in documents use the same live provider path as custom uploads when enabled while recorded responses remain a truthful fallback only.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, Vercel AI SDK 7.0.83, pdf-lib 1.17.1, @napi-rs/canvas 1.0.8, unpdf 1.8.1, Vitest 4.1.11 and Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-29-document-operations-workflow-redesign.md`

## Global Constraints

- Use only synthetic names, identifiers and figures. Never add Samsung, Kyndryl or client data.
- Only `Process document` may start a model request. Selecting, previewing or comparing fixtures costs nothing.
- API keys remain server-side. The browser receives availability booleans only.
- `providerDispatched` remains the sole proof that a provider was called.
- Unknown or unavailable models fail closed and never switch provider automatically.
- Built-in samples may use deterministic fallback only when the selected provider is unavailable.
- Custom documents never use deterministic fallback.
- Every sample remains one page, below 3 MB and visually marked as synthetic.
- Handwritten evidence is raster-only and typed evidence remains native PDF text.
- Follow TDD for every behavior change and commit after each independently testable task.

---

### Task 1: Define the ten-fixture domain matrix

**Files:**

- Modify: `src/domain/types.ts`
- Replace: `src/domain/fixtures.ts`
- Modify: `src/domain/outcomes.ts`
- Modify: `src/domain/action-policy.ts`
- Modify: `tests/unit/domain/fixtures.test.ts`
- Modify: `tests/unit/domain/outcomes.test.ts`
- Modify: `tests/unit/domain/action-policy.test.ts`
- Modify: `tests/unit/server/execute-run.test.ts`
- Modify: `tests/contract/providers/provider-contract.test.ts`

**Interfaces:**

- Produces: `DocumentFamily`, `VariantClassification`, `AttentionReason`, `HandwrittenEvidence` and the extended `SyntheticFixture` contract.
- Produces: `syntheticFixtures` with ten entries and `recordedDocumentRunResults` with one entry per fixture.
- Produces: A custom missing-field rule that returns the existing custom `not_found` enum as an incomplete-evidence result when any requested field lacks supported evidence.
- Consumes: Existing `Outcome`, `ActionProposal` and `FieldResult` types.

- [ ] **Step 1: Write the failing fixture-matrix tests**

Replace the three-fixture assertions with exact matrix assertions:

```ts
const expectedIds = [
  "invoice-clean-match",
  "invoice-buyer-hold",
  "invoice-unreadable-approval",
  "invoice-total-mismatch",
  "invoice-po-currency-mismatch",
  "warehouse-clean-receipt",
  "warehouse-quantity-correction",
  "warehouse-unreadable-damage-note",
  "warehouse-quantity-mismatch",
  "warehouse-item-lot-mismatch",
];

expect(syntheticFixtures.map((fixture) => fixture.id)).toEqual(expectedIds);
expect(
  Object.groupBy(syntheticFixtures, (fixture) => fixture.family),
).toMatchObject({
  supplier_invoice: expect.arrayContaining([expect.any(Object)]),
  warehouse_goods_receipt: expect.arrayContaining([expect.any(Object)]),
});
expect(
  syntheticFixtures.filter((fixture) => fixture.family === "supplier_invoice"),
).toHaveLength(5);
expect(
  syntheticFixtures.filter(
    (fixture) => fixture.family === "warehouse_goods_receipt",
  ),
).toHaveLength(5);
expect(syntheticFixtures.map((fixture) => fixture.classification)).toEqual(
  expect.arrayContaining([
    "correct",
    "correct",
    "attention",
    "attention",
    "attention",
    "attention",
    "incorrect",
    "incorrect",
    "incorrect",
    "incorrect",
  ]),
);
expect(
  syntheticFixtures.map((fixture) => fixture.expectedOutcome).sort(),
).toEqual([
  "clear",
  "clear",
  "incomplete",
  "incomplete",
  "needs_review",
  "needs_review",
  "needs_review",
  "needs_review",
  "needs_review",
  "needs_review",
]);
expect(recordedDocumentRunResults).toHaveLength(10);
```

Add assertions that invoice fixtures request exactly these keys:

```ts
[
  "supplier",
  "invoice_number",
  "purchase_order_number",
  "invoice_date",
  "currency",
  "invoice_total",
  "payment_terms",
  "reviewer_comments",
];
```

Add assertions that warehouse fixtures request exactly these keys:

```ts
[
  "goods_receipt_number",
  "delivery_note_number",
  "purchase_order_number",
  "item_code",
  "lot_number",
  "expected_quantity",
  "received_quantity",
  "damaged_quantity",
  "receiver_comments",
];
```

Replace index-based action-policy tests with ID-based assertions:

```ts
for (const fixture of syntheticFixtures) {
  expect(
    applyActionPolicy(fixture.expectedOutcome, proposal, fixture),
  ).toMatchObject({
    type: fixture.action.type,
    status: fixture.action.status,
  });
}

expect(applyActionPolicy("evidence_consistent", proposal, null).status).toBe(
  "ready",
);
expect(applyActionPolicy("conflict", proposal, null).status).toBe(
  "needs_review",
);
expect(applyActionPolicy("not_found", proposal, null).status).toBe("blocked");
```

In the recorded-provider contract replace every `invoice-exception-packet` identifier with `invoice-total-mismatch`. For each of the ten fixtures and both provider configurations assert requested-field order, exact fixture action, zero token usage, recorded execution mode and the fixture-specific recorded output. This produces 20 adapter cases but still only ten provider-neutral benchmark observations.

- [ ] **Step 2: Run the fixture tests and confirm the expected failure**

Run:

```powershell
npx vitest run tests/unit/domain/fixtures.test.ts tests/unit/domain/action-policy.test.ts tests/contract/providers/provider-contract.test.ts
```

Expected: FAIL because the current catalogue has three fixtures and the new metadata fields do not exist.

- [ ] **Step 3: Add the fixture contracts**

Add these exact types to `src/domain/types.ts`:

```ts
export type DocumentFamily = "supplier_invoice" | "warehouse_goods_receipt";

export type VariantClassification = "correct" | "attention" | "incorrect";

export type AttentionReason =
  | "manual_instruction"
  | "manual_correction"
  | "unreadable_critical_evidence"
  | "reference_conflict"
  | "none";

export type HandwrittenEvidence = {
  fieldKey: "reviewer_comments" | "receiver_comments";
  text: string;
  legibility: "legible" | "unclear";
};
```

Extend `SyntheticFixture` with:

```ts
family: DocumentFamily;
classification: VariantClassification;
variantLabel: string;
differenceSummary: string[];
attentionReason: AttentionReason;
handwrittenEvidence: HandwrittenEvidence | null;
```

- [ ] **Step 4: Encode the exact ten-fixture matrix**

Use these IDs and expected values as the stable contract:

```ts
const invoiceVariantContract = [
  ["invoice-clean-match", "correct", "none", "clear"],
  ["invoice-buyer-hold", "attention", "manual_instruction", "needs_review"],
  [
    "invoice-unreadable-approval",
    "attention",
    "unreadable_critical_evidence",
    "incomplete",
  ],
  ["invoice-total-mismatch", "incorrect", "reference_conflict", "needs_review"],
  [
    "invoice-po-currency-mismatch",
    "incorrect",
    "reference_conflict",
    "needs_review",
  ],
] as const;

const warehouseVariantContract = [
  ["warehouse-clean-receipt", "correct", "none", "clear"],
  [
    "warehouse-quantity-correction",
    "attention",
    "manual_correction",
    "needs_review",
  ],
  [
    "warehouse-unreadable-damage-note",
    "attention",
    "unreadable_critical_evidence",
    "incomplete",
  ],
  [
    "warehouse-quantity-mismatch",
    "incorrect",
    "reference_conflict",
    "needs_review",
  ],
  [
    "warehouse-item-lot-mismatch",
    "incorrect",
    "reference_conflict",
    "needs_review",
  ],
] as const;
```

Use invented organizations `Northstar Office Supply`, `Harborline Components`, `Vireo Industrial Goods`, `Meridian Packaging` and `Bluepeak Logistics`. Keep line-item values and reference values explicit in each fixture. Handwritten notes occupy the comments field. Set the comments field to `null` only for the two intentionally unreadable fixtures so the recorded fallback and reference suite expect no guess.

Create one `RecordedDocumentRunResult` per fixture by mapping every requested field to its document value, evidence, page, expected evaluator status and reference match. Do not duplicate observations by provider.

Update `statusForVerifiedOutcome` in `src/domain/action-policy.ts` with this exact order:

```ts
if (outcome === "incomplete" || outcome === "not_found") return "blocked";
if (outcome === "conflict" || outcome === "needs_review") return "needs_review";
if (outcome === "evidence_consistent" && fixture === null) return "ready";
if (!fixture || fixture.expectedOutcome !== outcome) return "needs_review";
return fixture.action.status;
```

Use `findFixture(id)` in tests instead of numeric fixture indices so catalogue order changes cannot silently point to a different business case.

- [ ] **Step 5: Run the focused fixture, policy and provider tests**

Run:

```powershell
npx vitest run tests/unit/domain/fixtures.test.ts tests/unit/domain/action-policy.test.ts tests/contract/providers/provider-contract.test.ts
```

Expected: PASS with ten fixtures and ten neutral recorded observations.

- [ ] **Step 6: Write failing custom partial-evidence tests**

Add outcome assertions:

```ts
expect(
  decideOutcome({
    sourceType: "custom",
    fields: [
      field(),
      field({ extractedValue: null, evaluatorStatus: "not_found" }),
    ],
  }),
).toBe("not_found");

expect(
  decideOutcome({
    sourceType: "custom",
    fields: [
      field({ evaluatorStatus: "conflict" }),
      field({ extractedValue: null, evaluatorStatus: "not_found" }),
    ],
  }),
).toBe("not_found");
```

Add an `executeRun` test with two custom requested fields where one field is grounded and one is absent. Assert the final event has `outcome: "not_found"`, the persisted action status is `blocked` and no completed event contains `evidence_consistent`.

- [ ] **Step 7: Run the missing-field tests and confirm failure**

```powershell
npx vitest run tests/unit/domain/outcomes.test.ts tests/unit/domain/action-policy.test.ts tests/unit/server/execute-run.test.ts
```

Expected: FAIL because the current custom rule returns `evidence_consistent` when only some fields are missing and the current custom action policy does not block `not_found`.

- [ ] **Step 8: Enforce incomplete custom evidence before conflict logic**

Replace the custom branch in `decideOutcome` with:

```ts
if (
  input.fields.some(
    (field) =>
      field.extractedValue === null || field.evaluatorStatus === "not_found",
  )
) {
  return "not_found";
}
if (input.fields.some((field) => field.evaluatorStatus === "conflict")) {
  return "conflict";
}
return "evidence_consistent";
```

The server already calls `decideOutcome` after all parallel field verifiers complete. Keep that single decision boundary and use the action-policy statuses defined in Step 4.

Preserve `not_found` as the custom outcome enum because the public custom labels are `Evidence-consistent`, `Conflict` and `Not found`. In the result explanation render `Incomplete evidence - one or more requested fields were not found` so a partial extraction is never presented as wholly absent or evidence-consistent. The workflow policy groups `not_found` with incomplete outcomes.

- [ ] **Step 9: Run the full Task 1 tests**

```powershell
npx vitest run tests/unit/domain/fixtures.test.ts tests/unit/domain/outcomes.test.ts tests/unit/domain/action-policy.test.ts tests/unit/server/execute-run.test.ts tests/contract/providers/provider-contract.test.ts
```

Expected: PASS with partial custom evidence blocked and all ten fallback adapters schema-valid.

- [ ] **Step 10: Commit the fixture and outcome contract**

```powershell
git add src/domain/types.ts src/domain/fixtures.ts src/domain/outcomes.ts src/domain/action-policy.ts tests/unit/domain/fixtures.test.ts tests/unit/domain/outcomes.test.ts tests/unit/domain/action-policy.test.ts tests/unit/server/execute-run.test.ts tests/contract/providers/provider-contract.test.ts
git commit -m "feat: add invoice and warehouse fixture matrix"
```

---

### Task 2: Generate realistic PDFs with raster handwriting

**Files:**

- Modify: `scripts/generate-sample-documents.mjs`
- Create: `assets/fonts/Caveat-VariableFont_wght.ttf`
- Create: `assets/fonts/Caveat-OFL.txt`
- Create: ten fixture PDFs under `public/samples`
- Delete: `public/samples/clean-match-invoice.pdf`
- Delete: `public/samples/invoice-exception-packet.pdf`
- Delete: `public/samples/invoice-total-mismatch.pdf`
- Delete: `public/samples/missing-purchase-order.pdf`
- Delete: `public/samples/visitor-access-request.pdf`
- Delete: `public/samples/warehouse-receiving-sheet.pdf`
- Modify: `tests/unit/domain/fixtures.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `syntheticFixtures` and `HandwrittenEvidence` from Task 1.
- Produces: Ten one-page PDFs whose native text contains typed fields and whose handwriting exists only in an embedded raster image.
- Uses: Caveat from the official `googlefonts/caveat` repository under OFL-1.1.

- [ ] **Step 1: Add failing PDF-content assertions**

For each generated fixture assert:

```ts
const document = await readFile(resolve("public/samples", fixture.filename));
const pdf = await getDocumentProxy(new Uint8Array(document));
const extracted = await extractText(pdf, { mergePages: true });

expect(document.byteLength).toBeLessThan(3 * 1024 * 1024);
expect(extracted.totalPages).toBe(1);
expect(extracted.text).toContain(fixture.title);
for (const field of fixture.requestedFields) {
  const value = fixture.documentData[field.key];
  const handwritten = fixture.handwrittenEvidence?.fieldKey === field.key;
  if (value && !handwritten) expect(extracted.text).toContain(value);
}
if (fixture.handwrittenEvidence?.text) {
  expect(extracted.text).not.toContain(fixture.handwrittenEvidence.text);
}
```

Also assert every generated file exists and filenames are unique.

- [ ] **Step 2: Run the PDF test and confirm it fails for selectable handwriting and missing files**

```powershell
npx vitest run tests/unit/domain/fixtures.test.ts
```

Expected: FAIL because the old three PDFs use selectable Courier text and seven new PDFs are absent.

- [ ] **Step 3: Mark the PDF authoring operation once**

Immediately before the first PDF generation command run exactly once:

```powershell
& 'C:\Users\nicho\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\nicho\.cache\codex-runtimes\codex-primary-runtime\plugins\openai-primary-runtime\plugins\pdf\skills\pdf\container_tools\mark_artifact_operation_started.mjs' --operation-kind create --expected-output-count 10 --output-format pdf
```

Expected: successful artifact-operation marker. The absolute paths above come from the loaded workspace dependency bundle `26.826.12353`. If that bundle version has changed, call `load_workspace_dependencies` and locate the PDF skill's `container_tools/mark_artifact_operation_started.mjs` before running its bundled Node executable. Do not run the marker again for this ten-PDF authoring operation.

- [ ] **Step 4: Bundle the handwriting font and licence**

Add the Caveat variable font as `assets/fonts/Caveat-VariableFont_wght.ttf` and its unmodified OFL-1.1 text as `assets/fonts/Caveat-OFL.txt`. Record the source in a comment at the top of the generator:

```js
// Caveat font source: https://github.com/googlefonts/caveat
// Licence: SIL Open Font License 1.1, copied to assets/fonts/Caveat-OFL.txt
```

- [ ] **Step 5: Replace the generator with two family layouts**

Implement these focused functions in `scripts/generate-sample-documents.mjs`:

```js
async function renderHandwriting(note, { seed, unclear }) {
  const canvas = createCanvas(1500, 220);
  const context = canvas.getContext("2d");
  context.font = "52px Caveat";
  context.fillStyle = "rgba(24, 62, 122, 0.86)";
  context.rotate((((seed % 5) - 2) * Math.PI) / 360);
  context.fillText(note, 34, 118);
  if (unclear) {
    context.strokeStyle = "rgba(24, 62, 122, 0.64)";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(260, 72);
    context.bezierCurveTo(520, 154, 760, 30, 1120, 134);
    context.stroke();
  }
  return canvas.toBuffer("image/png");
}

async function createSupplierInvoice(fixture, assets) {
  const document = await createBaseDocument(fixture);
  const page = document.addPage([595.28, 841.89]);
  drawPageFrame(page, assets);
  drawDocumentHeader(page, assets, {
    documentType: "SUPPLIER INVOICE",
    organization: fixture.documentData.supplier,
    identifier: fixture.documentData.invoice_number,
  });
  drawKeyValueGrid(page, assets, [
    ["Invoice date", fixture.documentData.invoice_date],
    ["Purchase order", fixture.documentData.purchase_order_number],
    ["Currency", fixture.documentData.currency],
    ["Payment terms", fixture.documentData.payment_terms],
  ]);
  drawInvoiceLineItems(page, assets, fixture.lineItems);
  drawInvoiceTotals(page, assets, fixture.financials);
  await drawCommentsBox(document, page, assets, fixture, "Reviewer comments");
  drawSyntheticFooter(page, assets, fixture.id);
  return document.save({ useObjectStreams: false });
}

async function createWarehouseReceipt(fixture, assets) {
  const document = await createBaseDocument(fixture);
  const page = document.addPage([595.28, 841.89]);
  drawPageFrame(page, assets);
  drawDocumentHeader(page, assets, {
    documentType: "WAREHOUSE GOODS RECEIPT",
    organization: fixture.warehouseName,
    identifier: fixture.documentData.goods_receipt_number,
  });
  drawKeyValueGrid(page, assets, [
    ["Delivery note", fixture.documentData.delivery_note_number],
    ["Purchase order", fixture.documentData.purchase_order_number],
    ["Carrier", fixture.carrier],
    ["Received date", fixture.receivedDate],
  ]);
  drawReceivingTable(page, assets, fixture.receivingRows);
  drawQuantitySummary(page, assets, {
    expected: fixture.documentData.expected_quantity,
    received: fixture.documentData.received_quantity,
    damaged: fixture.documentData.damaged_quantity,
  });
  await drawCommentsBox(document, page, assets, fixture, "Receiver comments");
  drawSyntheticFooter(page, assets, fixture.id);
  return document.save({ useObjectStreams: false });
}
```

Implement every called helper in the same file. `createBaseDocument` sets fixed title, author, creation date and modification date. `drawPageFrame` draws the white A4 body and restrained grey border. `drawDocumentHeader` uses the exact document type, organization and identifier passed above. `drawKeyValueGrid` draws two equal columns of label-value pairs. `drawInvoiceLineItems` and `drawReceivingTable` render exactly three rows from fixture data with fixed column widths. `drawInvoiceTotals` renders subtotal, tax and invoice total. `drawQuantitySummary` renders expected, received and damaged quantities. `drawSyntheticFooter` prints `SYNTHETIC INTERVIEW DEMONSTRATION - NO BUSINESS TRANSACTION` plus the fixture ID.

`drawCommentsBox` draws the supplied label. When `handwrittenEvidence` is null it writes the fixture comment as native Helvetica text. Otherwise it calls `renderHandwriting`, embeds the returned PNG and draws that image inside the box without drawing the note as PDF text. Use fixed coordinates, fixed dates and a fixture-derived numeric seed. Never use `Math.random()` or the current time. Register the bundled font through `GlobalFonts.registerFromPath` before raster rendering.

Write typed comments only when `handwrittenEvidence` is null. Otherwise embed the rendered PNG in the comments box and do not draw its text through pdf-lib.

- [ ] **Step 6: Remove the six superseded PDFs and generate all ten replacements**

Add a package script:

```json
"generate:samples": "node scripts/generate-sample-documents.mjs"
```

Run:

```powershell
git rm public/samples/clean-match-invoice.pdf public/samples/invoice-exception-packet.pdf public/samples/invoice-total-mismatch.pdf public/samples/missing-purchase-order.pdf public/samples/visitor-access-request.pdf public/samples/warehouse-receiving-sheet.pdf
npm run generate:samples
```

Expected: ten `Generated <filename>` lines. `public/samples` contains those ten fixture PDFs plus the existing `scanned-paper-texture.png` and no superseded PDF.

- [ ] **Step 7: Render every PDF for visual QA**

Use the bundled Poppler path returned by `load_workspace_dependencies` when `pdftoppm` is not on `PATH`:

```powershell
New-Item -ItemType Directory -Force 'tmp/pdfs/rendered' | Out-Null
Get-ChildItem 'public/samples/*.pdf' | ForEach-Object {
  pdftoppm -png -singlefile -r 150 $_.FullName (Join-Path 'tmp/pdfs/rendered' $_.BaseName)
}
```

Inspect all ten PNGs. Require aligned tables, readable typed text, realistic comments, visible synthetic labelling, no clipping and no black squares. Fix coordinates then regenerate and rerender until all pages pass.

Delete `tmp/pdfs/rendered` after inspection because rendered pages are verification intermediates rather than repository artifacts.

- [ ] **Step 8: Run PDF tests**

```powershell
npx vitest run tests/unit/domain/fixtures.test.ts
```

Expected: PASS with one page per fixture and raster-only handwriting.

- [ ] **Step 9: Commit the document assets**

```powershell
git add assets/fonts scripts/generate-sample-documents.mjs package.json public/samples tests/unit/domain/fixtures.test.ts
git commit -m "feat: generate realistic document fixtures"
```

---

### Task 3: Persist fixture identity and reserve the workflow schema

**Files:**

- Create: `migrations/0008_document_workflow.sql`
- Modify: `src/server/repositories/run-repository.ts`
- Modify: `src/server/workflow/execute-run.ts`
- Modify: `src/server/http/public-serialization.ts`
- Create: `tests/contract/persistence/document-workflow-migration.test.ts`
- Modify: `tests/unit/server/run-repository.test.ts`
- Modify: `tests/contract/routes/public-serialization.test.ts`

**Interfaces:**

- Produces: `StoredRunRecord.documentFamily` and `StoredRunRecord.fixtureId` as nullable fields.
- Produces: Database columns `runs.document_family`, `runs.fixture_id` and the unused-until-Plan-2 `workflow_events` table.
- Preserves: Existing rows as null legacy data and existing provider-dispatch serialization rules.

- [ ] **Step 1: Write failing migration and repository tests**

Assert the migration contains:

```sql
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS document_family text,
  ADD COLUMN IF NOT EXISTS fixture_id text;

CREATE TABLE IF NOT EXISTS workflow_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  action text NOT NULL,
  recipient_role text,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
```

Assert a created synthetic run preserves its family and fixture ID while a custom or legacy run preserves null values. Assert a non-dispatched row still serializes `provider: null` and `model: null` with configured values separate.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npx vitest run tests/contract/persistence/document-workflow-migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts
```

Expected: FAIL because migration 0008 and the metadata fields do not exist.

- [ ] **Step 3: Create migration 0008**

Create an idempotent transaction with exact action and status checks:

```sql
BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS document_family text,
  ADD COLUMN IF NOT EXISTS fixture_id text;

CREATE TABLE IF NOT EXISTS workflow_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'approve_and_stage', 'mark_for_later_review', 'assign_review',
    'request_clarification', 'request_clearer_document', 'prepare_email',
    'replace_document', 'retry_processing', 'download_summary'
  )),
  recipient_role text,
  status text NOT NULL CHECK (status IN ('prepared', 'staged', 'simulated')),
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_idempotency_idx
  ON workflow_events (run_id, action, COALESCE(recipient_role, ''));
CREATE INDEX IF NOT EXISTS workflow_events_run_created_idx
  ON workflow_events (run_id, created_at, id);

INSERT INTO schema_migrations (version)
  VALUES ('0008_document_workflow')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 4: Carry fixture identity through the repository**

Extend `StoredRunRecord` with:

```ts
documentFamily: DocumentFamily | null;
fixtureId: string | null;
```

Set these in `executeRun`:

```ts
documentFamily: input.fixture?.family ?? null,
fixtureId: input.fixture?.id ?? null,
```

Add `document_family` and `fixture_id` to Neon inserts, list selects and row hydration. Include sanitized values in active public list/detail DTOs. Expired/deleted details remain minimal.

- [ ] **Step 5: Run persistence tests**

```powershell
npx vitest run tests/contract/persistence/document-workflow-migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts
```

Expected: PASS for in-memory and SQL contract paths.

- [ ] **Step 6: Commit the persistence foundation**

```powershell
git add migrations/0008_document_workflow.sql src/server/repositories/run-repository.ts src/server/workflow/execute-run.ts src/server/http/public-serialization.ts tests/contract/persistence/document-workflow-migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts
git commit -m "feat: persist document family and fixture identity"
```

---

### Task 4: Make processing availability safe and built-in samples AI-enabled

**Files:**

- Modify: `src/server/http/container.ts`
- Modify: `src/app/api/models/route.ts`
- Modify: `src/server/http/runs-handler.ts`
- Modify: `src/server/http/multipart.ts`
- Modify: `src/server/workflow/live-provider.ts`
- Modify: `src/components/workbench/workbench-view.tsx`
- Modify: `src/components/workbench/workbench-controls.tsx`
- Modify: `tests/contract/routes/container.test.ts`
- Modify: `tests/contract/routes/models-route.test.ts`
- Modify: `tests/contract/routes/runs-route.test.ts`
- Modify: `tests/component/workbench.test.tsx`

**Interfaces:**

- Produces: `ProviderAvailability = Record<Provider, boolean>` in the model-catalog response.
- Produces: Live synthetic submission when the selected provider is available and recorded synthetic fallback otherwise.
- Preserves: Custom uploads require available live processing and provider attribution comes only from persisted detail.

- [ ] **Step 1: Write failing availability and routing tests**

Assert the model route returns:

```ts
{
  models: expect.any(Array),
  defaults: expect.any(Object),
  providerAvailability: { openai: true, anthropic: false },
}
```

for a test container with live mode enabled, an OpenAI key present and no Anthropic key.

In the Workbench component test select `invoice-buyer-hold`, mock OpenAI availability true and assert the submitted form and admission header use `live`. Then mock availability false and assert the same synthetic fixture uses `recorded`. Assert a custom file is not submitted when its provider is unavailable.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npx vitest run tests/contract/routes/container.test.ts tests/contract/routes/models-route.test.ts tests/contract/routes/runs-route.test.ts tests/component/workbench.test.tsx
```

Expected: FAIL because the model route has no availability and synthetic mode is hardcoded to recorded.

- [ ] **Step 3: Add safe provider availability to the container**

Add:

```ts
providerAvailability: {
  openai: liveModeEnabled && Boolean(environment.OPENAI_API_KEY),
  anthropic: liveModeEnabled && Boolean(environment.ANTHROPIC_API_KEY),
},
```

to `HttpContainer`. Return those booleans from `/api/models`. Never return key prefixes, lengths or failure details.

- [ ] **Step 4: Derive Workbench execution without visible mode controls**

Replace the current source-only rule with:

```ts
const providerAvailable = providerAvailability[provider];
const executionMode = providerAvailable ? "live" : "recorded";
if (source === "custom" && !providerAvailable) {
  setError("Document processing is unavailable for the selected model.");
  return;
}
form.set("executionMode", executionMode);
```

Keep matching `X-Run-Execution-Mode` and `X-Run-Source-Type` admission headers. The server continues rejecting recorded custom runs and live runs when global processing is disabled.

After completion fetch `/api/runs/[id]` before adding the comparison record. Use `providerCalled`, `provider` and `model` from the durable DTO. Remove the temporary `terminal.executionMode === "live"` attribution shortcut.

- [ ] **Step 5: Strengthen unclear-handwriting instructions**

Add to the provider system instruction:

```ts
"When handwriting is unclear, return null rather than guessing a critical value.",
"Do not reconstruct obscured characters from business context.",
```

Keep the shared output schema, file part and no-tools contract unchanged.

- [ ] **Step 6: Run routing tests**

```powershell
npx vitest run tests/contract/routes/container.test.ts tests/contract/routes/models-route.test.ts tests/contract/routes/runs-route.test.ts tests/component/workbench.test.tsx
```

Expected: PASS for available sample processing, sample fallback and unavailable custom recovery.

- [ ] **Step 7: Commit processing availability**

```powershell
git add src/server/http/container.ts src/app/api/models/route.ts src/server/http/runs-handler.ts src/server/http/multipart.ts src/server/workflow/live-provider.ts src/components/workbench/workbench-view.tsx src/components/workbench/workbench-controls.tsx tests/contract/routes/container.test.ts tests/contract/routes/models-route.test.ts tests/contract/routes/runs-route.test.ts tests/component/workbench.test.tsx
git commit -m "feat: process built-in documents with selected model"
```

---

### Task 5: Build the family library and actual-PDF Workbench

**Files:**

- Create: `src/components/workbench/fixture-library.tsx`
- Create: `src/components/workbench/document-preview.tsx`
- Modify: `src/components/workbench/workbench-view.tsx`
- Modify: `src/components/workbench/workbench-controls.tsx`
- Modify: `src/components/ui/primitives.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/component/workbench.test.tsx`
- Modify: `tests/e2e/workbench.spec.ts`
- Modify: `tests/e2e/document-preview.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**

- Consumes: Ten fixtures, family metadata and provider availability from earlier tasks.
- Produces: `FixtureLibrary` with family tabs and variant selection.
- Produces: `DocumentPreview` that shows the actual PDF and differences panel.
- Preserves: Upload picker, consent, trace, evidence, history and delete-now behavior.

- [ ] **Step 1: Write failing Workbench interaction tests**

Add component assertions:

```ts
expect(screen.getByRole("tab", { name: "Supplier invoices" })).toBeVisible();
expect(
  screen.getByRole("tab", { name: "Warehouse goods receipts" }),
).toBeVisible();
expect(screen.getAllByTestId("fixture-variant")).toHaveLength(5);
expect(screen.getByText("Correct")).toBeVisible();
expect(screen.getByText("Needs attention")).toBeVisible();
expect(screen.getByText("Incorrect")).toBeVisible();
expect(screen.getByRole("button", { name: "Process document" })).toBeVisible();
expect(screen.getByLabelText("Processing model")).toBeVisible();
expect(screen.getByLabelText("Processing model")).toHaveValue("gpt-5.6-luna");
expect(
  screen.getByRole("option", { name: "GPT-5.6 Luna - Recommended" }),
).toBeVisible();
expect(
  screen.getByRole("option", { name: "Claude Haiku 4.5 - Recommended" }),
).toBeVisible();
expect(
  screen.queryByText(/live custom|live provider|live-call/i),
).not.toBeInTheDocument();
```

Render a custom `not_found` result containing one passing field and one missing field then assert the explanation reads `Incomplete evidence - one or more requested fields were not found` and `Evidence-consistent` is absent.

Add a fetch assertion that switching tabs and selecting a variant does not POST `/api/runs`. Assert the selected preview iframe uses `/samples/<fixture.filename>` and the differences panel lists the fixture's `differenceSummary`.

Click `+ Add your document` and assert the existing hidden file input receives one click with `accept="application/pdf,image/png,image/jpeg"`. Assert no drag-only interaction is required.

- [ ] **Step 2: Run focused UI tests and confirm failure**

```powershell
npx vitest run tests/component/workbench.test.tsx
```

Expected: FAIL because the current source rail is flat and the simplified preview remains.

- [ ] **Step 3: Implement `FixtureLibrary`**

Use this public component contract:

```ts
export function FixtureLibrary(props: {
  fixtures: readonly SyntheticFixture[];
  selectedId: string;
  onSelect: (fixtureId: string) => void;
  onUpload: () => void;
  disabled?: boolean;
}): React.JSX.Element;
```

Use native buttons with `role="tab"`, `aria-selected`, roving selection through standard tab order and a `data-classification` attribute for styling. Render five variants for the active family and keep the `+ Add your document` button after the variants. Its `onUpload` callback programmatically activates the existing visually hidden file input so the system file picker opens immediately.

- [ ] **Step 4: Implement the actual PDF preview and difference panel**

Use this component contract:

```ts
export function DocumentPreview(props: {
  source: "synthetic" | "custom";
  fixture: SyntheticFixture;
  custom: CustomUploadState;
  previewUrl: string;
}): React.JSX.Element;
```

For synthetic documents render an iframe at `/samples/${fixture.filename}`, an `Open full document` link and the classification-aware `What changed` list. For custom files preserve the local object URL behavior and never show synthetic differences.

- [ ] **Step 5: Replace deployment copy**

Use these exact labels:

- `Processing model`
- `Process document`
- `<model display name> - Recommended` for GPT-5.6 Luna and Claude Haiku 4.5 only
- `Sample results - no AI processing` only when selected provider availability is false
- `Processing unavailable for this model` for disabled custom processing
- `Incomplete evidence - one or more requested fields were not found` for a custom `not_found` result

Keep all four supported models in one grouped `<select>` and keep the current model visibly selected through its `value`. Remove `KeylessNotice` from enabled mode. Replace it with a conditional `ProcessingStatus` component that renders nothing when the selected provider is available.

- [ ] **Step 6: Add classification and responsive styles**

Create CSS selectors:

```css
.fixture-tile[data-classification="correct"] {
  --fixture-accent: #1f7a56;
}
.fixture-tile[data-classification="attention"] {
  --fixture-accent: #b56a11;
}
.fixture-tile[data-classification="incorrect"] {
  --fixture-accent: #b43d3d;
}
.fixture-tile[aria-selected="true"] {
  border-color: var(--fixture-accent);
}
```

Use text labels and icons as well as colour. At the existing mobile breakpoint stack tabs, variant list, preview, differences and assurance result without horizontal overflow.

- [ ] **Step 7: Run component and browser tests**

```powershell
npx vitest run tests/component/workbench.test.tsx
npx playwright test tests/e2e/workbench.spec.ts tests/e2e/document-preview.spec.ts tests/e2e/accessibility.spec.ts
```

Expected: PASS with no POST during browsing, keyboard-operable tabs and correct actual-PDF previews.

- [ ] **Step 8: Commit the Workbench library**

```powershell
git add src/components/workbench/fixture-library.tsx src/components/workbench/document-preview.tsx src/components/workbench/workbench-view.tsx src/components/workbench/workbench-controls.tsx src/components/ui/primitives.tsx src/app/globals.css tests/component/workbench.test.tsx tests/e2e/workbench.spec.ts tests/e2e/document-preview.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "feat: add document family workbench"
```

---

### Task 6: Verify the document-processing slice

**Files:**

- Modify: `docs/evaluation-report.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Modify: `scripts/verify-public-surface.mjs`
- Modify: `tests/unit/scripts/public-surface.test.ts`

**Interfaces:**

- Consumes: Completed Tasks 1 through 5.
- Produces: Truthful documentation for ten deterministic references and credential-gated AI sample processing.

- [ ] **Step 1: Add failing public-surface assertions**

Assert the rendered source and verification script reject:

```ts
[/live custom-run/i, /live-call provider/i, /synthetic benchmark quality/i];
```

and require:

```ts
[/processing model/i, /reference quality suite/i];
```

- [ ] **Step 2: Run public-surface tests and confirm failure**

```powershell
npx vitest run tests/unit/scripts/public-surface.test.ts
```

Expected: FAIL while legacy copy remains.

- [ ] **Step 3: Update documentation without claiming live acceptance**

Document ten fixture references, AI-enabled built-in sample behavior, deterministic fallback, raster handwriting and the rule that no provider route is accepted until its production smoke test passes. Keep real email and external connectors out of scope.

- [ ] **Step 4: Run the complete slice verification**

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:component
npm run test:contract
npm run test:a11y
npm run build:production
npm run verify:public
```

Expected: every command exits 0. Do not continue to workflow implementation with a failing baseline.

- [ ] **Step 5: Commit verified documentation**

```powershell
git add README.md docs/architecture.md docs/evaluation-report.md scripts/verify-public-surface.mjs tests/unit/scripts/public-surface.test.ts
git commit -m "docs: describe AI document processing workflow"
```
