# Document-to-Action Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invoice-only extraction demonstration with a safe document-to-action workbench that supports real per-run model choice and operational dry-run actions.

**Architecture:** Introduce server-owned model and fixture catalogues then extend the shared extraction result with a constrained action proposal. Keep granular workflow events for telemetry while mapping them into three user-facing stages. Persist action data inside the existing structured run result and record staging as an idempotent run step.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Vercel AI SDK, Zod, Recharts, Neon Postgres, Vercel Blob, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-document-to-action-redesign.md`

## Global Constraints

- Do not use a comma before `and` or `or` in prose or user-facing lists.
- Do not use OpenAI or Anthropic API keys before deterministic implementation and verification are complete.
- Never imply that a deterministic demo result was produced by the selected model.
- Keep public upload consent and the less-than-24-hour visibility warning explicit.
- Models are accepted only from the server-owned catalogue and provider-model mismatches fail closed.
- Proposed actions are internal dry runs only and never contact an external system.
- Use TDD for every behavior change and preserve the existing 286-test green baseline.
- Runtime CSS remains the canonical token source while `DESIGN.md` mirrors accepted values.

---

### Task 1: Domain catalogues and action policy

**Files:**
- Create: `src/domain/live-model-catalog.ts`
- Create: `src/domain/action-policy.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/pricing.ts`
- Modify: `src/domain/fixtures.ts`
- Test: `tests/unit/domain/live-model-catalog.test.ts`
- Test: `tests/unit/domain/action-policy.test.ts`
- Test: `tests/unit/domain/fixtures.test.ts`
- Test: `tests/unit/domain/pricing.test.ts`

**Interfaces:**
- Produces: `LiveModelId`, `LiveModelDefinition`, `liveModelCatalog`, `requireEnabledModel(provider, model)` and `defaultModelForProvider(provider)`.
- Produces: `SyntheticFixture`, `ActionProposal`, `ActionStatus` and `applyActionPolicy(outcome, proposed, fixture)`.
- Consumes: existing `Provider`, `Outcome` and pricing cost helpers.

- [ ] **Step 1: Write failing catalogue tests**

```ts
expect(requireEnabledModel("openai", "gpt-5.6-luna").recommended).toBe(true);
expect(() => requireEnabledModel("anthropic", "gpt-5.6-luna")).toThrow();
expect(defaultModelForProvider("anthropic")).toBe("claude-haiku-4-5");
```

- [ ] **Step 2: Run `npm run test:unit -- tests/unit/domain/live-model-catalog.test.ts` and confirm failure because the catalogue does not exist**

- [ ] **Step 3: Implement the four-entry immutable model catalogue with provider, display name, recommendation, context window and dated input/output prices**

- [ ] **Step 4: Write failing fixture and action-policy tests for invoice review, warehouse clear and visitor blocked outcomes**

```ts
expect(syntheticFixtures.map((fixture) => fixture.expectedOutcome)).toEqual([
  "needs_review",
  "clear",
  "incomplete",
]);
expect(applyActionPolicy("incomplete", proposal, visitorFixture).status).toBe("blocked");
```

- [ ] **Step 5: Replace invoice-specific fixture data with the neutral fixture catalogue and implement deterministic action policy**

- [ ] **Step 6: Make pricing helpers consume catalogue definitions and estimate maximum cost for the selected model**

- [ ] **Step 7: Run the four focused unit suites then run `npm run typecheck`**

- [ ] **Step 8: Commit with `feat: add document action and model catalogues`**

### Task 2: Request validation, provider plumbing and action persistence

**Files:**
- Modify: `src/server/http/multipart.ts`
- Modify: `src/server/http/container.ts`
- Modify: `src/server/http/runs-handler.ts`
- Modify: `src/server/workflow/provider.ts`
- Modify: `src/server/workflow/live-provider.ts`
- Modify: `src/server/workflow/recorded-provider.ts`
- Modify: `src/server/workflow/execute-run.ts`
- Modify: `src/server/repositories/run-repository.ts`
- Modify: `src/server/security/rate-limit.ts`
- Modify: `src/domain/run-schema.ts`
- Create: `src/app/api/models/route.ts`
- Create: `src/app/api/runs/[id]/stage-action/route.ts`
- Create: `src/server/http/stage-action-handler.ts`
- Test: `tests/contract/providers/provider-contract.test.ts`
- Test: `tests/contract/providers/live-provider-runtime.test.ts`
- Test: `tests/contract/routes/runs-route.test.ts`
- Test: `tests/contract/routes/stage-action-route.test.ts`
- Test: `tests/unit/server/execute-run.test.ts`
- Test: `tests/unit/server/rate-limit.test.ts`

**Interfaces:**
- Consumes: `requireEnabledModel`, `estimateMaximumLiveRunCost`, `ActionProposal` and `applyActionPolicy` from Task 1.
- Produces: parsed `model`, enabled model response, action-aware extraction result and `POST /api/runs/[id]/stage-action`.

- [ ] **Step 1: Write failing route tests for a valid model, an unknown model and a provider-model mismatch**

```ts
form.set("provider", "openai");
form.set("model", "claude-haiku-4-5");
expect((await POST(request)).status).toBe(400);
```

- [ ] **Step 2: Run the focused route test and confirm the current parser ignores or lacks `model`**

- [ ] **Step 3: Parse and validate `model` then pass it through provider construction, run persistence and per-model quota reservation**

- [ ] **Step 4: Write failing provider tests for shared fields, document instruction and constrained action proposal output**

- [ ] **Step 5: Extend the shared Zod output schema and both provider adapters while keeping document content untrusted and tool access disabled**

- [ ] **Step 6: Write failing workflow tests proving deterministic policy overrides unsafe model status and synthetic fixture metadata controls final actions**

- [ ] **Step 7: Apply action policy before persistence and expose action data through existing public serialization**

- [ ] **Step 8: Write failing stage-action tests for permitted, duplicate, blocked, expired and deleted runs**

- [ ] **Step 9: Implement idempotent action staging as a run step with no connector or external call**

- [ ] **Step 10: Add `GET /api/models` and test that only enabled server-owned metadata is returned**

- [ ] **Step 11: Run contract, workflow, rate-limit and typecheck suites**

- [ ] **Step 12: Commit with `feat: support per-run models and staged actions`**

### Task 3: Synthetic document assets and benchmark truth

**Files:**
- Create: `scripts/generate-sample-documents.mjs`
- Create: `public/samples/invoice-exception-packet.pdf`
- Create: `public/samples/warehouse-receiving-sheet.pdf`
- Create: `public/samples/visitor-access-request.pdf`
- Create: `public/samples/scanned-paper-texture.png`
- Modify: `src/server/http/metrics-handler.ts`
- Modify: `docs/evaluation-report.md`
- Test: `tests/unit/domain/fixtures.test.ts`
- Test: `tests/unit/server/metrics-handler.test.ts`

**Interfaces:**
- Consumes: `syntheticFixtures` from Task 1.
- Produces: deterministic checked-in PDFs whose filenames and exact evidence text match fixture metadata.

- [ ] **Step 1: Write failing tests that require each fixture asset to exist and contain its expected exact field values**

- [ ] **Step 2: Run the fixture tests and confirm failure because the new assets do not exist**

- [ ] **Step 3: Generate one project-bound scan texture with the built-in image generation tool and copy it into `public/samples/scanned-paper-texture.png`**

- [ ] **Step 4: Mark the PDF artifact operation then implement the deterministic PDF generator with typed forms, untidy handwritten annotations and the generated scan texture**

- [ ] **Step 5: Generate all three PDFs and render every page to PNG for visual inspection**

- [ ] **Step 6: Inspect rendered pages for legibility, evidence correctness and public-safe content then correct any defect**

- [ ] **Step 7: Replace invoice-only benchmark truth with fixture-driven expected outcomes and action statuses**

- [ ] **Step 8: Run fixture and metrics tests**

- [ ] **Step 9: Commit with `feat: add operational document fixtures`**

### Task 4: Workbench interaction redesign

**Files:**
- Create: `src/components/workbench/trace-model.ts`
- Create: `src/components/workbench/action-card.tsx`
- Modify: `src/components/workbench/workbench-controls.tsx`
- Modify: `src/components/workbench/workbench-view.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/ui/primitives.tsx`
- Modify: `src/app/globals.css`
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Modify: `docs/design/fidelity-ledger.md`
- Test: `tests/unit/components/trace-model.test.ts`
- Test: `tests/component/workbench.test.tsx`
- Test: `tests/e2e/workbench.spec.ts`
- Test: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: `/api/models`, action-aware run details, `POST /api/runs/[id]/stage-action` and fixture metadata.
- Produces: grouped model select, upload tile, three-stage trace, action-first results and action staging feedback.

- [ ] **Step 1: Write failing trace tests that map raw stages into `Understand document`, `Verify evidence` and `Resolve and prepare action` while excluding publishing**

- [ ] **Step 2: Implement the pure trace mapping module and pass its unit tests**

- [ ] **Step 3: Write failing component tests for the grouped native model select and selected `model` form value**

- [ ] **Step 4: Replace provider radio cards with one grouped model select populated from the approved catalogue**

- [ ] **Step 5: Write failing component tests for three fixture cards followed by a keyboard-operable `+ Add your document` tile that opens the file input**

- [ ] **Step 6: Recompose the source rail around the sample tiles and reuse the existing upload validation and consent flow**

- [ ] **Step 7: Write failing component tests for the three-stage streamed trace, hidden publishing and action-card staging states**

- [ ] **Step 8: Implement the grouped trace and action card then place the action before the evidence ledger**

- [ ] **Step 9: Remove `Public prototype` and `Recorded replay` product copy while preserving one `Demo data — no provider call` label in demo mode**

- [ ] **Step 10: Update runtime styles and both design contracts in the same changeset**

- [ ] **Step 11: Run unit, component, accessibility and Workbench E2E tests**

- [ ] **Step 12: Commit with `feat: redesign workbench for document actions`**

### Task 5: Operations action monitoring and documentation

**Files:**
- Modify: `src/server/http/metrics-handler.ts`
- Modify: `src/components/operations/operations-console.tsx`
- Modify: `src/components/operations/run-explorer.tsx`
- Modify: `src/app/globals.css`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/privacy-and-retention.md`
- Modify: `docs/walkthrough-script.md`
- Modify: `docs/deployment-checklist.md`
- Test: `tests/component/operations.test.tsx`
- Test: `tests/e2e/operations.spec.ts`

**Interfaces:**
- Consumes: action counts and action proposal data from Tasks 1 and 2.
- Produces: action readiness metrics, staged dry-run count and action details in the run explorer.

- [ ] **Step 1: Write failing metrics tests for ready, needs-review, blocked and staged action counts**

- [ ] **Step 2: Extend metrics aggregation without changing illustrative savings semantics**

- [ ] **Step 3: Write failing Operations component tests for action summary cards and run-level action detail**

- [ ] **Step 4: Implement action monitoring panels and keep granular diagnostics behind the run explorer**

- [ ] **Step 5: Remove outdated invoice-only and replay-oriented documentation then document the model catalogue and dry-run boundary**

- [ ] **Step 6: Run metrics, Operations component and Operations E2E tests**

- [ ] **Step 7: Commit with `feat: monitor staged document actions`**

### Task 6: Full verification, visual evidence and deployment handoff

**Files:**
- Modify: `docs/design/verification/workbench-1536x1024.png`
- Modify: `docs/design/verification/workbench-390x844-reduced-motion.png`
- Modify: `docs/design/verification/operations-1536x1024.png`
- Modify: `docs/design/fidelity-ledger.md`
- Modify: `docs/evaluation-report.md`

**Interfaces:**
- Consumes: the completed application.
- Produces: verified branch and current visual evidence without using live provider keys.

- [ ] **Step 1: Run `npm run design:lint` and the premium static auditor in strict mode**

- [ ] **Step 2: Run anti-pattern searches against changed UI files and resolve every true match**

- [ ] **Step 3: Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:a11y`, `npm run test:e2e` and `npm run build`**

- [ ] **Step 4: Start the production build locally then verify fixture runs, keyboard model selection, upload validation, action staging and Operations drill-down in Chromium**

- [ ] **Step 5: Verify desktop, mobile and reduced-motion layouts then capture updated screenshot evidence**

- [ ] **Step 6: Search HTML, client output, logs and public traces for API keys, deletion tokens, hidden prompts and misleading provider attribution**

- [ ] **Step 7: Update the evaluation report with exact deterministic results and remaining live-key gates**

- [ ] **Step 8: Commit with `test: verify document-to-action redesign`**
