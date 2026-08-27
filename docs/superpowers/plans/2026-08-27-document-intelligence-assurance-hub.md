# Document Intelligence Assurance Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a deployable public-safe document assurance prototype with recorded replay mode and credential-gated live provider adapters.

**Architecture:** A Next.js App Router application keeps domain rules in pure TypeScript modules and routes external work through injected storage, telemetry and provider ports. Recorded fixtures exercise the same public result contract as live adapters. Neon and Blob integrations activate only when their server credentials exist.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, Vercel AI SDK, direct OpenAI and Anthropic adapters, Zod, Drizzle ORM, Neon Postgres, Vercel Blob, Recharts, Vitest, Testing Library, Playwright and axe.

**Spec:** `docs/superpowers/specs/2026-08-27-document-intelligence-assurance-hub-design.md`

## Global Constraints

- Do not create, store or use model credentials until Nicholas explicitly authorizes that step.
- Do not name a Kyndryl client or claim production ownership or measured savings.
- Custom files are PDF, PNG or JPG with a 3 MB maximum and five-page PDF maximum.
- Custom runs request exactly two or three fields and require unchecked 24-hour public-visibility consent.
- One run uses one provider and may retry once only after a provider 429 or 5xx response.
- Detailed public data expires before 24 hours while anonymous aggregates may survive cleanup.
- API keys, deletion-token hashes, full system prompts and hidden reasoning never reach public output.
- All user-visible list prose follows the workspace rule that omits a comma before `and` or `or`.

---

### Task 1: Foundation, fixtures and domain rules

**Files:**
- Create: `package.json`, application configuration and test configuration.
- Create: `src/domain/types.ts`, `src/domain/run-schema.ts`, `src/domain/file-validation.ts`, `src/domain/outcomes.ts`, `src/domain/pricing.ts`, `src/domain/resource-model.ts` and `src/domain/fixtures.ts`.
- Create: `public/samples/*.pdf` and `tests/unit/domain/*.test.ts`.

**Interfaces:**
- Produces `validateUpload(input): UploadValidation`, `decideOutcome(input): Outcome`, `estimateRunCost(input): number` and `calculateResourceScenario(input): ResourceScenarioResult`.
- Produces typed `Provider`, `RunStatus`, `Outcome`, `FieldResult` and `RunEvent` contracts for all later tasks.

- [ ] Write unit tests with hand-derived expectations for file limits, field counts, outcome rules, cost pricing and resource formulas.
- [ ] Run each test and verify the missing module or behavior causes the expected failure.
- [ ] Implement the smallest pure modules that pass the tests.
- [ ] Generate the three synthetic invoice PDFs and matching purchase-order fixtures.
- [ ] Run unit tests, typecheck and lint then commit the task.

### Task 2: Persistence, retention and workflow ports

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/repositories/run-repository.ts`, `src/server/storage/document-store.ts`, `src/server/security/rate-limit.ts`, `src/server/security/deletion-token.ts`, `src/server/workflow/provider.ts`, `src/server/workflow/recorded-provider.ts`, `src/server/workflow/live-provider.ts`, `src/server/workflow/execute-run.ts` and `tests/unit/server/*.test.ts`.

**Interfaces:**
- Consumes Task 1 domain contracts.
- Produces `RunRepository`, `DocumentStore`, `ExtractionProvider` and `executeRun(input, dependencies): AsyncGenerator<RunEvent>`.

- [ ] Write failing tests for deletion-token hashing, expiry, anonymous quotas, one-retry behavior, no provider switching, parallel evaluator completion and idempotent purge.
- [ ] Verify every test fails for the named missing behavior.
- [ ] Implement in-memory adapters first then optional Neon, Blob and live AI adapters behind environment checks.
- [ ] Verify recorded and mocked live providers return the same Zod-validated result contract.
- [ ] Run server unit and contract tests then commit the task.

### Task 3: Public API and streaming route contract

**Files:**
- Create: `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts`, `src/app/api/runs/[id]/document/route.ts`, `src/app/api/metrics/route.ts`, `src/app/api/cron/purge-expired/route.ts`, `src/server/http/*` and route contract tests.

**Interfaces:**
- Consumes Task 2 ports and workflow generator.
- Produces the documented POST, GET and DELETE response shapes with newline-delimited streamed run events.

- [ ] Write failing route tests for multipart validation, `no-store`, `noindex`, safe errors, deletion authorization and cron authorization.
- [ ] Verify the tests fail against missing routes.
- [ ] Implement the routes with server-only dependencies and recorded replay fallback.
- [ ] Scan serialized responses for keys, deletion-token hashes, full prompts and hidden reasoning.
- [ ] Run route tests and commit the task.

### Task 4: Workbench and Operations UI

**Files:**
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/workbench/page.tsx`, `src/app/operations/page.tsx`, shared UI primitives and feature components under `src/components`.
- Create: component and accessibility tests plus Playwright workflows.

**Interfaces:**
- Consumes the Task 3 public API and Task 1 public types.
- Produces the full recorded Workbench run, comparison experience, Operations explorer and resource calculator.

- [ ] Write failing component tests for consent, exact custom field counts, provider selection, streamed stages, comparison, calculator edits and safe deletion dialog.
- [ ] Implement shared primitives and the first Workbench viewport from the accepted concept.
- [ ] Compare a browser screenshot with the Workbench concept and fix visible drift.
- [ ] Implement Operations from its accepted concept then repeat screenshot comparison.
- [ ] Run component, accessibility and E2E tests then commit the task.

### Task 5: Hardening, documentation and deployment

**Files:**
- Create: `README.md`, `.env.example`, `vercel.json`, database migration files, architecture diagram source, evaluation report and deployment checklist.
- Modify: any implementation file required by verified defects.

**Interfaces:**
- Consumes the completed application.
- Produces a stable recorded-replay deployment and a documented live-credential acceptance gate.

- [ ] Inject provider, storage, quota and cleanup failures through tests.
- [ ] Run security scans for public serialization and secret-bearing identifiers.
- [ ] Run formatter, lint, typecheck, unit, component, accessibility, E2E, premium audit and production build.
- [ ] Verify desktop, mobile, keyboard, reduced-motion and route error states in a real browser.
- [ ] Deploy the keyless recorded-replay build to Vercel and smoke-test both public routes.
- [ ] Document that live OpenAI and Anthropic acceptance remains pending explicit credential authorization then commit the task.

