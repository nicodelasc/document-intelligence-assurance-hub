# Procurement Document Exception Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the deployed portfolio application around procurement exception triage, install two reviewer-written handwriting fixtures and preserve a safe rollback to the current production release.

**Architecture:** Keep the existing Next.js routes, persistence schema, deterministic evaluator and simulated workflow endpoint. Narrow the server-owned action allowlist, update both route presentations and add an explicit local visual-grounding mode for live synthetic fixtures. Preserve historical action identifiers so existing stored runs remain readable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Playwright, unpdf, Tesseract.js, pdf-lib, Vercel and Git.

**Spec:** `docs/superpowers/specs/2026-08-31-procurement-exception-triage.md`

## Global Constraints

- Follow `DESIGN.md`, `UX-CONTRACT.md` and `premium-ui.json`.
- Do not use provider credentials or make paid model calls.
- Write a failing test before production code for every behavior change.
- Keep ERP, payment, inventory, archive and email delivery out of scope.
- Keep all documents and references synthetic.
- Preserve provider dispatch attribution, public retention and early deletion behavior.
- Keep the native model select as the canonical `Select/Listbox` owner.
- Preserve five-step guided-tour focus, inert-background, compact-viewport and reduced-motion contracts.
- Use the exact outcome and action copy from the specification.
- Do not place a comma before list-ending `and` or `or` in generated text.
- Preserve the pre-change commit as the rollback target.

---

### Task 1: Workbench procurement triage and action policy

**Files:**
- Modify: `tests/unit/domain/workflow-actions.test.ts`
- Modify: `tests/contract/routes/workflow-actions-route.test.ts`
- Modify: `tests/unit/components/trace-model.test.ts`
- Modify: `tests/component/workbench.test.tsx`
- Modify: `tests/component/workbench-guided-tour.test.tsx`
- Modify: `src/domain/workflow-actions.ts`
- Modify: `src/domain/fixtures.ts`
- Modify: `src/components/workbench/workbench-view.tsx`
- Modify: `src/components/workbench/workflow-panel.tsx`
- Modify: `src/components/workbench/activity-timeline.tsx`
- Modify: `src/components/workbench/trace-model.ts`
- Modify: `src/components/workbench/guided-tour-config.ts`
- Modify: `src/components/workbench/how-it-works-dialog.tsx`

**Interfaces:**
- Consumes: Existing `WorkflowActionType`, `WorkflowEventStatus`, `ActionProposal`, `Outcome` and route capability contract.
- Produces: A narrower server-owned allowlist and prepared-only posting handoff while retaining historical action identifiers.

- [ ] **Step 1: Write action-policy tests that fail against the current broad control set**

Assert these literal arrays from `allowedWorkflowActionsForRun`:

```ts
expect(clearActions).toEqual(["approve_and_stage"]);
expect(reviewActions).toEqual(["assign_review", "prepare_email"]);
expect(incompleteActions).toEqual([
  "request_clearer_document",
  "assign_review",
  "replace_document",
]);
expect(failedActions).toEqual(["retry_processing"]);
expect(guardedActions).toEqual(["replace_document"]);
expect(workflowStatusForAction("approve_and_stage")).toBe("prepared");
```

- [ ] **Step 2: Run the focused unit and contract tests and verify they fail for the old allowlist and staged status**

Run: `npm run test:unit -- tests/unit/domain/workflow-actions.test.ts tests/unit/components/trace-model.test.ts`

Run: `npm run test:contract -- tests/contract/routes/workflow-actions-route.test.ts`

Expected: FAIL because broad actions and `staged` are still returned.

- [ ] **Step 3: Write Workbench component and tour tests for the approved business copy**

Cover the heading `Review incoming procurement documents`, action `Assess for exceptions`, terminal heading `Exception triage decision`, section `Prepared next step`, three scoped action groups and the five approved tour titles. Assert removed controls are absent.

- [ ] **Step 4: Run focused Workbench tests and verify they fail against the old tool-first copy**

Run: `npm run test:component -- tests/component/workbench.test.tsx tests/component/workbench-guided-tour.test.tsx`

Expected: FAIL on old headings, old actions and old tour copy.

- [ ] **Step 5: Implement the minimum server-owned action policy and Workbench copy changes**

Retain internal action identifiers. Map `Draft clarification request` to `prepare_email` so the existing bounded preview remains available. Return `prepared` for `approve_and_stage`. Update fixture proposal titles and summaries so no text claims downstream posting occurred.

- [ ] **Step 6: Run focused unit, contract and component tests until green**

Run the commands from Steps 2 and 4. Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```text
feat: focus Workbench on procurement exception triage
```

### Task 2: Business-first Operations review queue

**Files:**
- Modify: `tests/component/operations.test.tsx`
- Modify: `tests/e2e/operations.spec.ts`
- Modify: `tests/e2e/reviewer-regressions.spec.ts`
- Modify: `tests/e2e/dual-guided-tours.spec.ts`
- Modify: `src/components/operations/operations-dashboard.tsx`
- Modify: `src/components/operations/operations-workspace.tsx`
- Modify: `src/components/operations/run-explorer.tsx`
- Modify: `src/components/operations/guided-tour-config.ts`
- Modify: `src/components/operations/how-it-works-dialog.tsx`

**Interfaces:**
- Consumes: Existing `MetricsPayload`, `ExplorerRun`, fixture metadata and URL-backed provider/outcome/query/run/page state.
- Produces: A queue-first presentation without widening the metrics API or exposing detailed result fields in list payloads.

- [ ] **Step 1: Write component tests for the new page, summary, queue, status and inspector vocabulary**

Assert `Procurement review operations`, `Documents triaged`, `Exception rate`, `Procurement review queue`, `Triage status`, `Prepared case handoffs`, `Public demo retention` and `Review record and technical trace`.

- [ ] **Step 2: Write an ordering test that requires the review queue before technical panels**

Use DOM order to require `Procurement review queue` before `Processing performance` and `Reference quality suite`.

- [ ] **Step 3: Run the Operations component suite and verify the new assertions fail**

Run: `npm run test:component -- tests/component/operations.test.tsx`

Expected: FAIL on old labels and old panel order.

- [ ] **Step 4: Implement the queue-first Operations presentation**

Derive document reference, document type and exception summary from existing fixture metadata. Keep the current URL parameter names and selection behavior. Move model, latency, expiry, tokens and safe diagnostics into the inspector instead of business-first queue columns.

- [ ] **Step 5: Update the five-step Operations tour without changing the spotlight engine**

Use this order: `Triage overview`, `Procurement review queue`, `Workflow health`, `Assurance safeguards` and `Cost governance`. Keep five stable target IDs and all current focus-recovery behavior.

- [ ] **Step 6: Run focused component and browser tests**

Run: `npm run test:component -- tests/component/operations.test.tsx`

Run: `npx playwright test tests/e2e/operations.spec.ts tests/e2e/reviewer-regressions.spec.ts tests/e2e/dual-guided-tours.spec.ts`

Expected: PASS with URL restoration, inspector selection, desktop order and mobile tour geometry intact.

- [ ] **Step 7: Commit Task 2**

```text
feat: lead Operations with the procurement review queue
```

### Task 3: Approved handwriting fixtures and visual grounding

**Files:**
- Create: `assets/sample-overrides/invoice-unreadable-approval.pdf`
- Create: `assets/sample-overrides/warehouse-unreadable-damage-note.pdf`
- Create: `assets/sample-overrides/invoice-unreadable-approval.png`
- Create: `assets/sample-overrides/warehouse-unreadable-damage-note.png`
- Modify: `public/samples/invoice-unreadable-approval.pdf`
- Modify: `public/samples/warehouse-unreadable-damage-note.pdf`
- Modify: `public/samples/invoice-unreadable-approval.png`
- Modify: `public/samples/warehouse-unreadable-damage-note.png`
- Modify: `scripts/generate-sample-documents.mjs`
- Modify: `src/server/workflow/document-grounding.ts`
- Modify: `src/server/workflow/execute-run.ts`
- Modify: `tests/unit/server/document-grounding.test.ts`
- Modify: `tests/unit/server/execute-run.test.ts`
- Modify: `tests/unit/domain/fixtures.test.ts`
- Modify: `tests/e2e/document-preview.spec.ts`
- Modify: `tests/unit/scripts/release-artifacts.test.ts`

**Interfaces:**
- Consumes: `DocumentGroundingInput`, `ExecuteRunInput.fixture`, canonical sample filenames and existing five-page plus pixel limits.
- Produces: `visualMode?: "text_or_scan" | "text_and_visual"` on grounding input with `text_or_scan` as the default.

- [ ] **Step 1: Write a real-behavior grounding test for a text-native PDF with raster handwriting**

Create one in-memory one-page PDF containing native text plus an embedded PNG that says `HOLD PAYMENT`. Assert the default path returns native text only then assert `visualMode: "text_and_visual"` returns both native text and OCR text.

- [ ] **Step 2: Write execute-run tests for explicit visual mode and fail-closed fixture outcomes**

Capture the input supplied to an injected `documentGrounder`. Assert a live synthetic fixture with handwritten evidence requests `text_and_visual`. Assert recorded synthetic fixtures do not call grounding. Assert provider-supplied readable text absent from grounded evidence cannot produce `clear` or `evidence_consistent`.

- [ ] **Step 3: Run the focused grounding tests and verify they fail because visual mode does not exist**

Run: `npm run test:unit -- tests/unit/server/document-grounding.test.ts tests/unit/server/execute-run.test.ts`

Expected: FAIL on missing `visualMode` behavior.

- [ ] **Step 4: Implement bounded native-plus-visual page grounding**

When visual mode is active render every validated page, run the existing local OCR worker and merge OCR output with native extraction before `assertPageText`. Keep cancellation, timeout, page-count, image-allocation and text-length guards unchanged. Default mode continues to OCR only nearly textless pages.

- [ ] **Step 5: Install the approved PDF and PNG overrides**

Copy the exact approved PDFs from the specification into `assets/sample-overrides/`. Render each to a matching PNG at 1191 px width. Copy the four approved assets to their canonical `public/samples/` paths. Update the generator to copy override PDFs instead of recreating them.

- [ ] **Step 6: Add fixture and release tests for source preservation and preview geometry**

Assert both public PDFs byte-match their approved repository overrides, printed identifiers remain extractable, comment handwriting is absent from native extraction and both PNGs share the recorded rendered dimensions.

- [ ] **Step 7: Run fixture, grounding, release and preview tests**

Run: `npm run test:unit -- tests/unit/server/document-grounding.test.ts tests/unit/server/execute-run.test.ts tests/unit/domain/fixtures.test.ts tests/unit/scripts/release-artifacts.test.ts`

Run: `npx playwright test tests/e2e/document-preview.spec.ts`

Expected: PASS with zero false-clear regressions.

- [ ] **Step 8: Render and visually inspect both final PDFs**

Confirm readable printed fields, visible handwritten marks, synthetic footer, no clipping and no broken glyphs.

- [ ] **Step 9: Commit Task 3**

```text
feat: install reviewer-written handwriting fixtures
```

### Task 4: Contracts, release artifacts and full verification

**Files:**
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/evaluation-report.md`
- Modify: `docs/walkthrough-script.md`
- Modify: `scripts/record-walkthrough.mjs`
- Modify: `tests/unit/scripts/public-surface.test.ts`
- Modify: `tests/unit/scripts/record-walkthrough.test.ts`
- Modify: `tests/unit/scripts/release-documentation.test.ts`
- Modify: `tests/unit/scripts/release-artifacts.test.ts`

**Interfaces:**
- Consumes: Approved product specification plus Tasks 1 to 3.
- Produces: Durable design, UX, architecture, evaluation and walkthrough records that match the released UI.

- [ ] **Step 1: Write failing release-documentation and walkthrough assertions for the new business vocabulary**

Require the procurement problem statement, scoped action set, queue-first Operations description, approved fixture override rule and visual-grounding boundary. Reject old primary labels such as `Approve and stage` and `Run explorer` from release-facing documentation.

- [ ] **Step 2: Run focused release tests and verify they fail against stale documentation**

Run: `npm run test:unit -- tests/unit/scripts/public-surface.test.ts tests/unit/scripts/record-walkthrough.test.ts tests/unit/scripts/release-documentation.test.ts tests/unit/scripts/release-artifacts.test.ts`

- [ ] **Step 3: Update durable contracts and release documentation**

Keep the existing visual identity and runtime tokens. Update only the approved product purpose, component vocabulary, action policy, queue order and visual-grounding contract.

- [ ] **Step 4: Run formatting then all static and automated checks**

Run these fresh commands:

```text
npm run format
npm run format:check
npm run design:lint
npm run lint
npm run typecheck
npm test
npm run test:a11y
npm run test:e2e
npm run verify:premium
npm run build:production
npm run verify:public
npm run audit:dependencies
```

- [ ] **Step 5: Run the strict premium audit and changed-code anti-pattern searches**

Run `audit_project.py` from the installed frontend-design-premium skill with `--mode strict`. Search changed files for native dialogs, non-semantic click targets, missing form ownership, false affordances, uncancelled fetches and leaked viewport sizing.

- [ ] **Step 6: Verify the complete user story in a real browser**

Verify desktop and 390 px mobile Workbench plus Operations. Exercise one clear fixture, one needs-review fixture, one unreadable fixture, both guided tours, the reduced action controls, queue selection, URL restoration, inspector detail, narrow layout, keyboard focus, reduced motion and one safe failure state. Confirm no provider call is attributed.

- [ ] **Step 7: Commit Task 4**

```text
docs: align release package with procurement triage
```

- [ ] **Step 8: Preserve rollback, merge, push and deploy**

Create a named rollback tag or branch at `b4f7f90`. Review the complete feature diff. Merge the verified feature branch into `main`, push both rollback reference and `main`, wait for Vercel production deployment then smoke-test `/workbench`, `/operations`, `/api/models` and `/api/metrics`.
