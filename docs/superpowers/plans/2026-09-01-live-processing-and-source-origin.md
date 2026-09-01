# Live Processing and Source-Origin Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate visible live-provider processing while adding an honest source-origin boundary that accepts screenshots and modified documents but prevents unverified evidence from preparing a posting handoff.

**Architecture:** A server-only SHA-256 matcher classifies each run as `server_original`, `recognized_copy` or `unverified` before provider construction. The derived status flows through persistence and public serializers into Workbench policy and Operations metrics. Existing direct OpenAI and Anthropic adapters remain unchanged while the frontend makes live intent and dated pricing visible before one deliberate submission.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vercel AI SDK, Neon Postgres, Vitest, Playwright and Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-09-01-live-processing-and-source-origin.md`

## Global Constraints

- Never read, print, log or expose API-key values.
- Do not make a paid provider call during Tasks 1 through 7.
- Keep automatic provider retries disabled and never switch providers silently.
- Preserve user-owned untracked `output/` and `tmp/` directories.
- Built-in fixture bytes come from the server and never from a client upload.
- A screenshot, scan, crop, metadata change, PDF rewrite or re-encoding must remain processable as `unverified`.
- Source-origin status must not claim authorship, legal authenticity, fraud detection or malware safety.
- Unverified evidence must never enable `approve_and_stage`.
- Use exact provider pricing dated 2026-09-01: GPT-5.6 Luna US$0.20 input and US$1.20 output per million tokens, GPT-5.6 Terra US$2 input and US$12 output, Claude Haiku 4.5 US$1 input and US$5 output and Claude Sonnet 5 US$2 input and US$10 output.
- Run at most one final paid call per configured provider and only after production redeployment.
- Do not use a comma before list-ending `and` or `or` in generated reviewer-facing text.

## File Structure

### Create

- `src/server/security/source-origin.ts` — server-only SHA-256 digest and exact fixture matching.
- `src/server/security/sample-origin-manifest.ts` — checked-in fixture ID to SHA-256 mapping.
- `scripts/generate-sample-origin-manifest.mjs` — deterministic manifest generation and drift checking.
- `migrations/0010_source_origin_status.sql` — additive run-origin column and conservative historical backfill.
- `tests/unit/server/source-origin.test.ts` — matcher and semantic-boundary tests.
- `tests/unit/scripts/sample-origin-manifest.test.ts` — manifest drift tests.
- `tests/contract/persistence/source-origin-migration.test.ts` — migration shape and idempotency contract.
- `tests/e2e/live-production-smoke.spec.ts` — opt-in no-retry production smoke with a request-count guard.

### Modify

- `src/domain/types.ts` — public `SourceOriginStatus` type.
- `src/domain/live-model-catalog.ts` — refresh pricing date while retaining current verified rates and recommended models.
- `src/domain/action-policy.ts` — force unverified custom evidence to human review.
- `src/domain/workflow-actions.ts` — origin-aware action allowlist.
- `src/server/http/container.ts` — inject a server-only custom-origin classifier.
- `src/server/http/multipart.ts` — derive origin after structural validation.
- `src/server/http/runs-handler.ts` — propagate server-derived origin into execution.
- `src/server/workflow/execute-run.ts` — persist origin with every run.
- `src/server/repositories/run-repository.ts` — read, write, backfill and aggregate origin status.
- `src/server/http/public-serialization.ts` — expose only the bounded status enum.
- `src/server/http/metrics-handler.ts` — return origin totals and queue values.
- `src/components/ui/primitives.tsx` — show live or deterministic processing status.
- `src/components/workbench/workbench-controls.tsx` — show dated pricing and recommendation detail.
- `src/components/workbench/workbench-view.tsx` — submit-label logic, live attribution and result-origin badge.
- `src/components/workbench/workflow-panel.tsx` — explain restricted actions for unverified sources.
- `src/components/operations/operations-dashboard.tsx` — accept origin aggregates.
- `src/components/operations/operations-workspace.tsx` — render origin summary.
- `src/components/operations/run-explorer.tsx` — render queue and detail origin labels.
- `src/app/globals.css` — compact live and origin badges with mobile-safe wrapping.
- `README.md`, `docs/architecture.md`, `docs/evaluation-report.md`, `docs/privacy-and-retention.md` and `docs/deployment-checklist.md` — document live acceptance and source boundaries.
- Focused unit, component, contract and browser tests listed in each task.

---

### Task 1: Server-only source-origin matcher

**Files:**
- Create: `src/server/security/source-origin.ts`
- Create: `src/server/security/sample-origin-manifest.ts`
- Create: `scripts/generate-sample-origin-manifest.mjs`
- Create: `tests/unit/server/source-origin.test.ts`
- Create: `tests/unit/scripts/sample-origin-manifest.test.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/unit/domain/fixtures.test.ts`

**Interfaces:**
- Produces: `SourceOriginStatus = "server_original" | "recognized_copy" | "unverified"`.
- Produces: `classifyCustomSourceOrigin(bytes: Uint8Array): "recognized_copy" | "unverified"`.
- Produces: `sampleOriginManifest: Readonly<Record<string, string>>` where values are lowercase 64-character SHA-256 digests.
- Consumes: `syntheticFixtures` and their canonical PDF filenames.

- [ ] **Step 1: Write matcher tests before implementation**

```ts
import { describe, expect, it } from "vitest";
import {
  classifyCustomSourceOrigin,
  sha256Hex,
} from "@/server/security/source-origin";

describe("source origin", () => {
  it("recognizes exact committed fixture bytes regardless of upload filename", async () => {
    const bytes = await readFixture("invoice-clean-match.pdf");
    expect(classifyCustomSourceOrigin(bytes)).toBe("recognized_copy");
  });

  it("accepts one changed byte as unverified instead of rejecting it", async () => {
    const bytes = await readFixture("invoice-clean-match.pdf");
    const changed = new Uint8Array(bytes);
    changed[changed.length - 1] ^= 1;
    expect(classifyCustomSourceOrigin(changed)).toBe("unverified");
  });

  it("does not treat a PNG screenshot as an exact PDF copy", async () => {
    const bytes = await readFixture("invoice-clean-match.png");
    expect(classifyCustomSourceOrigin(bytes)).toBe("unverified");
  });

  it("returns a lowercase 64-character digest", () => {
    expect(sha256Hex(new TextEncoder().encode("document"))).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run tests/unit/server/source-origin.test.ts tests/unit/scripts/sample-origin-manifest.test.ts`

Expected: FAIL because the matcher and manifest do not exist.

- [ ] **Step 3: Add the shared type and server-only matcher**

```ts
// src/domain/types.ts
export type SourceOriginStatus =
  | "server_original"
  | "recognized_copy"
  | "unverified";

// src/server/security/source-origin.ts
import { createHash } from "node:crypto";
import { sampleOriginManifest } from "./sample-origin-manifest";

const recognizedDigests = new Set(Object.values(sampleOriginManifest));

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyCustomSourceOrigin(
  bytes: Uint8Array,
): "recognized_copy" | "unverified" {
  return recognizedDigests.has(sha256Hex(bytes))
    ? "recognized_copy"
    : "unverified";
}
```

The generation script must enumerate only `syntheticFixtures[*].filename`, sort by fixture ID and write a stable TypeScript map. Its `--check` mode compares generated content with the checked-in file and exits non-zero on drift without modifying the workspace.

- [ ] **Step 4: Generate the checked-in manifest then verify drift detection**

Run: `node scripts/generate-sample-origin-manifest.mjs`

Run: `node scripts/generate-sample-origin-manifest.mjs --check`

Expected: the second command exits 0 and every protected PDF has one digest.

- [ ] **Step 5: Run Task 1 tests and static checks**

Run: `npx vitest run tests/unit/server/source-origin.test.ts tests/unit/scripts/sample-origin-manifest.test.ts tests/unit/domain/fixtures.test.ts`

Run: `npm run typecheck`

Expected: PASS with no paid call.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- src/domain/types.ts src/server/security/source-origin.ts src/server/security/sample-origin-manifest.ts scripts/generate-sample-origin-manifest.mjs tests/unit/server/source-origin.test.ts tests/unit/scripts/sample-origin-manifest.test.ts tests/unit/domain/fixtures.test.ts
git commit -m "feat: classify exact and unverified document sources"
```

### Task 2: Additive origin persistence and public serialization

**Files:**
- Create: `migrations/0010_source_origin_status.sql`
- Create: `tests/contract/persistence/source-origin-migration.test.ts`
- Modify: `src/server/repositories/run-repository.ts`
- Modify: `src/server/http/public-serialization.ts`
- Test: `tests/unit/server/run-repository.test.ts`
- Test: `tests/contract/persistence/migration.test.ts`
- Test: `tests/contract/routes/public-serialization.test.ts`

**Interfaces:**
- Consumes: `SourceOriginStatus` from Task 1.
- Produces: required `sourceOriginStatus: SourceOriginStatus` on stored and public run records.
- Produces: public JSON field `sourceOriginStatus` with no digest or matched fixture identifier.

- [ ] **Step 1: Write failing migration, repository and serializer assertions**

```ts
expect(stored.sourceOriginStatus).toBe("unverified");
expect(serializePublicRunListRow(stored)).toMatchObject({
  sourceOriginStatus: "unverified",
});
expect(JSON.stringify(serializePublicRunDetail(stored))).not.toContain("sha256");
```

The migration contract must assert an additive `source_origin_status` column, a three-value check constraint, a synthetic-to-`server_original` backfill, a custom-to-`unverified` backfill and idempotent replay protection.

- [ ] **Step 2: Run persistence tests and confirm RED**

Run: `npx vitest run tests/contract/persistence/source-origin-migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts`

Expected: FAIL because the column and record property do not exist.

- [ ] **Step 3: Add the migration and repository mapping**

```sql
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS source_origin_status TEXT;

UPDATE runs
SET source_origin_status = CASE
  WHEN source_type = 'synthetic' THEN 'server_original'
  ELSE 'unverified'
END
WHERE source_origin_status IS NULL;

ALTER TABLE runs
  ALTER COLUMN source_origin_status SET NOT NULL;
```

Add an idempotent named constraint that permits only `server_original`, `recognized_copy` and `unverified`. Update every Neon insert, detailed select, list select and row mapper. In-memory records must clone the new property without deriving it from client data.

- [ ] **Step 4: Expose only the bounded status in public responses**

```ts
function serializeSourceOrigin(run: PublicRunRecord): SourceOriginStatus {
  return run.sourceOriginStatus;
}
```

Do not serialize digest values, matched fixture IDs or the manifest.

- [ ] **Step 5: Run Task 2 tests and typecheck**

Run: `npx vitest run tests/contract/persistence/source-origin-migration.test.ts tests/contract/persistence/migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- migrations/0010_source_origin_status.sql src/server/repositories/run-repository.ts src/server/http/public-serialization.ts tests/contract/persistence/source-origin-migration.test.ts tests/contract/persistence/migration.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts
git commit -m "feat: persist source origin status"
```

### Task 3: Derive origin before provider construction and propagate it through execution

**Files:**
- Modify: `src/server/http/container.ts`
- Modify: `src/server/http/multipart.ts`
- Modify: `src/server/http/runs-handler.ts`
- Modify: `src/server/workflow/execute-run.ts`
- Test: `tests/contract/routes/container.test.ts`
- Test: `tests/contract/routes/runs-route.test.ts`
- Test: `tests/unit/server/execute-run.test.ts`
- Test: `tests/contract/routes/test-support.ts`

**Interfaces:**
- Consumes: `classifyCustomSourceOrigin(bytes)` from Task 1.
- Produces: `HttpContainer.classifyCustomSourceOrigin(bytes)` for dependency injection.
- Produces: `ParsedRunRequest.sourceOriginStatus` and `ExecuteRunInput.sourceOriginStatus`.
- Guarantees: unverified input is admitted normally and the client cannot override the derived status.

- [ ] **Step 1: Write failing route and execution tests**

Add cases that prove:

```ts
expect(parsedSynthetic.sourceOriginStatus).toBe("server_original");
expect(parsedExactCopy.sourceOriginStatus).toBe("recognized_copy");
expect(parsedScreenshot.sourceOriginStatus).toBe("unverified");
expect(createProvider).toHaveBeenCalledTimes(1);
expect(executeInput.sourceOriginStatus).toBe("unverified");
```

Send a multipart field named `sourceOriginStatus=server_original` with an unverified PNG and assert that the execution input remains `unverified`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/contract/routes/container.test.ts tests/contract/routes/runs-route.test.ts tests/unit/server/execute-run.test.ts`

Expected: FAIL because origin is not part of admission or execution.

- [ ] **Step 3: Inject and derive origin**

```ts
// HttpContainer
classifyCustomSourceOrigin: (
  bytes: Uint8Array,
) => "recognized_copy" | "unverified";

// parseRunMultipart synthetic branch
sourceOriginStatus: "server_original",

// parseRunMultipart custom branch after validateUpload succeeds
sourceOriginStatus: container.classifyCustomSourceOrigin(bytes),
```

Ignore any multipart value that resembles an origin status. The server-derived property must be the only value propagated.

- [ ] **Step 4: Persist the origin in executeRun before storage and provider dispatch**

Add `sourceOriginStatus` to `ExecuteRunInput` and the new run record. Keep validation and origin classification before provider construction. Do not change the live adapter or add a second provider call.

- [ ] **Step 5: Run Task 3 tests and typecheck**

Run: `npx vitest run tests/contract/routes/container.test.ts tests/contract/routes/runs-route.test.ts tests/unit/server/execute-run.test.ts`

Run: `npm run typecheck`

Expected: PASS with mocked providers only.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- src/server/http/container.ts src/server/http/multipart.ts src/server/http/runs-handler.ts src/server/workflow/execute-run.ts tests/contract/routes/container.test.ts tests/contract/routes/runs-route.test.ts tests/unit/server/execute-run.test.ts tests/contract/routes/test-support.ts
git commit -m "feat: derive run origin before model dispatch"
```

### Task 4: Enforce origin-aware human-review actions

**Files:**
- Modify: `src/domain/action-policy.ts`
- Modify: `src/domain/workflow-actions.ts`
- Modify: `src/server/http/workflow-action-handler.ts`
- Test: `tests/unit/domain/action-policy.test.ts`
- Test: `tests/unit/domain/workflow-actions.test.ts`
- Test: `tests/contract/routes/workflow-actions-route.test.ts`
- Test: `tests/unit/server/execute-run.test.ts`

**Interfaces:**
- Consumes: `SourceOriginStatus` from Task 1 and persisted run origin from Task 2.
- Produces: `applyActionPolicy(..., sourceOriginStatus)`.
- Produces: `allowedWorkflowActionsForRun({ status, outcome, documentClassification, sourceOriginStatus })`.

- [ ] **Step 1: Write failing policy tests**

```ts
expect(
  applyActionPolicy(
    "evidence_consistent",
    proposedAction,
    null,
    "supplier_invoice",
    "unverified",
  ).status,
).toBe("needs_review");

expect(
  allowedWorkflowActionsForRun({
    status: "completed",
    outcome: "evidence_consistent",
    documentClassification: "supplier_invoice",
    sourceOriginStatus: "unverified",
  }),
).toEqual(["assign_review", "prepare_email"]);
```

Also assert that `approve_and_stage` is denied through the HTTP handler even when a client submits it directly for an unverified evidence-consistent run.

- [ ] **Step 2: Run policy tests and confirm RED**

Run: `npx vitest run tests/unit/domain/action-policy.test.ts tests/unit/domain/workflow-actions.test.ts tests/contract/routes/workflow-actions-route.test.ts`

Expected: FAIL because origin is not consulted.

- [ ] **Step 3: Add the unverified policy override**

```ts
const unverifiedEvidenceConsistentActions = Object.freeze<WorkflowActionType[]>([
  "assign_review",
  "prepare_email",
]);

if (
  input.sourceOriginStatus === "unverified" &&
  (input.outcome === "clear" || input.outcome === "evidence_consistent")
) {
  return unverifiedEvidenceConsistentActions;
}
```

Preserve existing needs-review, incomplete, failed, irrelevant and uncertain mappings. Update the proposal reason to: `Evidence was extracted consistently but the source is unverified. Assign a reviewer before any posting handoff.`

- [ ] **Step 4: Make the HTTP handler use persisted origin only**

Read `sourceOriginStatus` from the stored run. Never accept it in the workflow-action request body.

- [ ] **Step 5: Run Task 4 tests and typecheck**

Run: `npx vitest run tests/unit/domain/action-policy.test.ts tests/unit/domain/workflow-actions.test.ts tests/contract/routes/workflow-actions-route.test.ts tests/unit/server/execute-run.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- src/domain/action-policy.ts src/domain/workflow-actions.ts src/server/http/workflow-action-handler.ts tests/unit/domain/action-policy.test.ts tests/unit/domain/workflow-actions.test.ts tests/contract/routes/workflow-actions-route.test.ts tests/unit/server/execute-run.test.ts
git commit -m "feat: require review for unverified sources"
```

### Task 5: Make live execution and pricing explicit in Workbench

**Files:**
- Modify: `src/domain/live-model-catalog.ts`
- Modify: `src/components/ui/primitives.tsx`
- Modify: `src/components/workbench/workbench-controls.tsx`
- Modify: `src/components/workbench/workbench-view.tsx`
- Modify: `src/components/workbench/workflow-panel.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/domain/live-model-catalog.test.ts`
- Test: `tests/unit/domain/pricing.test.ts`
- Test: `tests/component/workbench.test.tsx`
- Test: `tests/e2e/workbench.spec.ts`
- Test: `tests/e2e/workbench-decision-guidance.spec.ts`

**Interfaces:**
- Consumes: `/api/models` pricing fields and provider availability.
- Consumes: public `sourceOriginStatus` from Task 2.
- Produces: reviewer-visible live status, selected pricing, execution-specific button label and bounded origin badge.

- [ ] **Step 1: Write failing catalogue and component tests**

```ts
expect(pricingAsOf).toBe("2026-09-01");
expect(screen.getByText("Live AI processing")).toBeVisible();
expect(screen.getByRole("button", { name: "Run live document review" })).toBeEnabled();
expect(screen.getByText(/US\$0\.20 input.*US\$1\.20 output/i)).toBeVisible();
expect(screen.getByText("Source unverified")).toBeVisible();
expect(screen.queryByRole("button", { name: /posting handoff/i })).not.toBeInTheDocument();
```

Add a fetch spy that asserts no `POST /api/runs` occurs after initial render, model selection, sample selection, preview opening or file validation. Assert exactly one POST after one primary-action click.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/unit/domain/live-model-catalog.test.ts tests/unit/domain/pricing.test.ts tests/component/workbench.test.tsx`

Expected: FAIL because live status, pricing copy and origin UI are absent.

- [ ] **Step 3: Refresh dated pricing and preserve cheapest defaults**

Set `pricingAsOf = "2026-09-01"`. Keep `gpt-5.6-luna` and `claude-haiku-4-5` as the only `recommended: true` entries for their providers. Extend `ModelOption` parsing with `pricingAsOf`, `inputPerMillionUsd` and `outputPerMillionUsd`.

- [ ] **Step 4: Render explicit execution intent**

```ts
export function runButtonLabel(input: {
  source: "synthetic" | "custom";
  providerAvailable: boolean;
}): string {
  if (input.providerAvailable) return "Run live document review";
  return input.source === "synthetic"
    ? "Assess sample without AI processing"
    : "Processing unavailable for this model";
}
```

`ProcessingStatus` must render `Live AI processing` when availability is confirmed. Keep model changes disabled while a run is active. Do not add an automatic call or an additional confirmation modal.

- [ ] **Step 5: Render bounded origin and restricted-action explanation**

Show `Original demo document`, `Exact copy of a demo document` or `Source unverified` next to the completed review result. For unverified evidence show: `The document was processed but its source was not verified. A person must review it before any posting handoff.`

- [ ] **Step 6: Run component and browser checks**

Run: `npx vitest run tests/unit/domain/live-model-catalog.test.ts tests/unit/domain/pricing.test.ts tests/component/workbench.test.tsx`

Run: `npx playwright test tests/e2e/workbench.spec.ts tests/e2e/workbench-decision-guidance.spec.ts --workers=1`

Expected: PASS with mocked network responses and zero provider calls.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- src/domain/live-model-catalog.ts src/components/ui/primitives.tsx src/components/workbench/workbench-controls.tsx src/components/workbench/workbench-view.tsx src/components/workbench/workflow-panel.tsx src/app/globals.css tests/unit/domain/live-model-catalog.test.ts tests/unit/domain/pricing.test.ts tests/component/workbench.test.tsx tests/e2e/workbench.spec.ts tests/e2e/workbench-decision-guidance.spec.ts
git commit -m "feat: expose live processing and source status"
```

### Task 6: Add origin visibility to Operations

**Files:**
- Modify: `src/server/repositories/run-repository.ts`
- Modify: `src/server/http/metrics-handler.ts`
- Modify: `src/components/operations/operations-dashboard.tsx`
- Modify: `src/components/operations/operations-workspace.tsx`
- Modify: `src/components/operations/run-explorer.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/server/metrics-handler.test.ts`
- Test: `tests/component/operations.test.tsx`
- Test: `tests/e2e/operations.spec.ts`

**Interfaces:**
- Consumes: persisted and public `sourceOriginStatus` from Task 2.
- Produces: `origin: { serverOriginal: number; recognizedCopy: number; unverified: number }` inside Operations metrics.
- Produces: origin label in every queue row and selected-run metadata panel.

- [ ] **Step 1: Write failing aggregate and UI tests**

```ts
expect(payload.operations.origin).toEqual({
  serverOriginal: 2,
  recognizedCopy: 1,
  unverified: 3,
});
expect(screen.getByText("Unverified uploads")).toBeVisible();
expect(screen.getByText("Source unverified")).toBeVisible();
```

The component test must also confirm that provider, token and cost values still depend on confirmed dispatch rather than configured selection.

- [ ] **Step 2: Run focused Operations tests and confirm RED**

Run: `npx vitest run tests/unit/server/metrics-handler.test.ts tests/component/operations.test.tsx`

Expected: FAIL because origin aggregates and labels are absent.

- [ ] **Step 3: Add aggregate calculation and public payload**

Count the newest public run summaries by `sourceOriginStatus` while keeping repository-wide lifecycle and confirmed provider usage semantics unchanged. Do not expose digests or manifest entries.

- [ ] **Step 4: Render a compact source-status summary and inspector row**

Use three plain labels: `Original demo runs`, `Exact-copy uploads` and `Unverified uploads`. Add `Source check` to selected-run metadata. Ensure the queue remains business-first and mobile stacking has no horizontal page overflow.

- [ ] **Step 5: Run Operations checks**

Run: `npx vitest run tests/unit/server/metrics-handler.test.ts tests/component/operations.test.tsx`

Run: `npx playwright test tests/e2e/operations.spec.ts --workers=1`

Expected: PASS with mocked data.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- src/server/repositories/run-repository.ts src/server/http/metrics-handler.ts src/components/operations/operations-dashboard.tsx src/components/operations/operations-workspace.tsx src/components/operations/run-explorer.tsx src/app/globals.css tests/unit/server/metrics-handler.test.ts tests/component/operations.test.tsx tests/e2e/operations.spec.ts
git commit -m "feat: monitor document source status"
```

### Task 7: Documentation, full mocked verification and release checkpoint

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/evaluation-report.md`
- Modify: `docs/privacy-and-retention.md`
- Modify: `docs/deployment-checklist.md`
- Modify: `scripts/verify-public-surface.mjs`
- Test: `tests/unit/scripts/public-surface.test.ts`
- Test: `tests/unit/scripts/release-documentation.test.ts`

**Interfaces:**
- Consumes: all Task 1 through Task 6 behavior.
- Produces: truthful release documentation and a public-surface secret scanner that knows the new safe labels.

- [ ] **Step 1: Write failing documentation assertions**

Require the documentation to contain `Source unverified`, `one deliberate reviewer click`, `Prepared only - not sent`, `GPT-5.6 Luna`, `Claude Haiku 4.5` and the two-call acceptance boundary. Require the scanner to reject API-key patterns and document digests in public output.

- [ ] **Step 2: Run documentation tests and confirm RED**

Run: `npx vitest run tests/unit/scripts/public-surface.test.ts tests/unit/scripts/release-documentation.test.ts`

Expected: FAIL until documentation is aligned.

- [ ] **Step 3: Update architecture, privacy, evaluation and deployment documentation**

State clearly that exact matching proves byte equality only. State that screenshots and changed documents are processed as unverified. Separate mocked acceptance from the two connected production observations.

- [ ] **Step 4: Run the full mocked verification matrix**

Run in this order and stop on the first failure:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e -- --workers=1
npm run build
npm run verify:premium
npm run audit:dependencies
git diff --check
```

Start the built application locally with `AI_LIVE_ENABLED=false` and `ALLOW_IN_MEMORY_PERSISTENCE=true` then run `npm run verify:public -- http://127.0.0.1:3000`. Stop the local process after the check.

Expected: every check passes with no paid model call. Connected-production assertions remain pending until Task 8.

- [ ] **Step 5: Create the rollback checkpoint and commit Task 7**

```powershell
git add -- README.md docs/architecture.md docs/evaluation-report.md docs/privacy-and-retention.md docs/deployment-checklist.md scripts/verify-public-surface.mjs tests/unit/scripts/public-surface.test.ts tests/unit/scripts/release-documentation.test.ts
git commit -m "docs: document live source assurance rollout"
git tag pre-live-source-origin-20260901 4a17bcf
```

The tag must resolve to the approved design baseline before implementation commits.

### Task 8: Production migration, redeployment and two guarded paid smokes

**Files:**
- Create: `tests/e2e/live-production-smoke.spec.ts`
- Modify: `docs/deployment-checklist.md`
- Modify: `docs/evaluation-report.md`

**Interfaces:**
- Consumes: production Vercel project, existing server-only keys, Neon database and stable public URL.
- Produces: one OpenAI built-in observation and one Anthropic unverified-upload observation with safe run IDs and confirmed provider attribution.

- [ ] **Step 1: Add an opt-in paid smoke spec with a hard request-count guard**

```ts
test.skip(process.env.RUN_PAID_SMOKE !== "1", "paid smoke requires explicit opt-in");
test.describe.configure({ mode: "serial", retries: 0 });

let submittedRuns = 0;
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().endsWith("/api/runs")) {
    submittedRuns += 1;
    if (submittedRuns > 1) throw new Error("paid_smoke_request_limit");
  }
});
```

Each test opens a fresh browser context and permits exactly one `POST /api/runs`. The OpenAI case selects a built-in clean fixture with `gpt-5.6-luna`. The Anthropic case uploads `public/samples/invoice-clean-match.png` as a custom PNG with two safe fields and consent then selects `claude-haiku-4-5`. The second result must show `Source unverified`.

- [ ] **Step 2: Run the paid spec without opt-in and confirm it skips**

Run: `npx playwright test tests/e2e/live-production-smoke.spec.ts --workers=1 --retries=0`

Expected: SKIPPED and zero provider calls.

- [ ] **Step 3: Apply the additive production migration**

Run the checked-in `migrations/0010_source_origin_status.sql` against the existing Neon `DATABASE_URL` through the established migration method. Do not print the URL. Verify only safe schema metadata and migration success.

- [ ] **Step 4: Redeploy production once**

Run: `npx vercel --prod --yes`

Record the immutable deployment URL and confirm the stable alias still points to the new deployment.

- [ ] **Step 5: Verify provider availability without spending credit**

Request `https://document-intelligence-assurance-hub.vercel.app/api/models` and output only provider-availability booleans plus public model IDs. Both provider booleans must be `true`. Confirm no response contains `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `sk-` or raw secret-like values.

- [ ] **Step 6: Run exactly one paid OpenAI smoke**

Run only the OpenAI test with `RUN_PAID_SMOKE=1`, `--workers=1` and `--retries=0`. Verify one provider-dispatched run, model `gpt-5.6-luna`, a terminal safe result and non-negative trustworthy usage.

Do not rerun on failure. Inspect safe platform logs then request fresh approval before another paid attempt.

- [ ] **Step 7: Run exactly one paid Anthropic smoke**

Run only the Anthropic test with `RUN_PAID_SMOKE=1`, `--workers=1` and `--retries=0`. Verify one provider-dispatched run, model `claude-haiku-4-5`, `Source unverified`, no posting-handoff control and a terminal safe result.

Do not rerun on failure. Inspect safe platform logs then request fresh approval before another paid attempt.

- [ ] **Step 8: Verify production surfaces after both calls**

Run:

```powershell
npm run verify:public -- https://document-intelligence-assurance-hub.vercel.app
```

Use the browser to verify Workbench and Operations at desktop and 390 px mobile widths. Confirm no console errors, no horizontal overflow, live attribution in Operations and bounded source labels.

- [ ] **Step 9: Record only observed acceptance evidence and commit**

Update the evaluation report and deployment checklist with provider, model, safe run ID, observed outcome, confirmed provider-dispatch flag, estimated cost and timestamp. Do not claim untested paths passed.

```powershell
git add -- tests/e2e/live-production-smoke.spec.ts docs/deployment-checklist.md docs/evaluation-report.md
git commit -m "test: record guarded live provider acceptance"
git push origin main
```

- [ ] **Step 10: Final rollback and cleanliness check**

Run:

```powershell
git status --short
git show-ref --tags pre-live-source-origin-20260901
git log --oneline -10
```

Expected: only the pre-existing user-owned `output/` and `tmp/` entries remain untracked. The rollback tag resolves to `4a17bcf` and production URLs remain accessible.
