# Task 8 pre-release guarded paid-smoke report

Date: 2026-09-01

Status: Pre-release harness complete. Connected production acceptance remains Pending.

## Scope completed

- Added an opt-in Playwright spec for one OpenAI built-in observation and one Anthropic custom-upload observation.
- Added one fresh browser context and one request counter per provider test.
- Intercepted `POST /api/runs` before network. A second submission is aborted with `paid_smoke_request_limit`.
- Added `x-provider-attempt-limit: 1` to the permitted smoke submission.
- Added server support that recognizes only the exact value `1`. Missing, larger, smaller and invalid values retain the ordinary two-attempt ceiling.
- Preserved AI SDK `maxRetries: 0` and the ordinary workflow policy of one retry.
- Kept both connected production observations Pending.

## Strict TDD evidence

### Server attempt cap

RED command:

`npx vitest run tests/contract/routes/runs-route.test.ts -t "attempt|ordinary transient"`

Observed RED: two smoke-marked contract cases failed because both 429 and 503 responses made two provider adapter attempts instead of one.

GREEN command:

`npx vitest run tests/contract/routes/runs-route.test.ts -t "attempt|ordinary transient"`

Observed GREEN: 7 passed and 35 skipped. Smoke-marked 429 and 503 cases made one attempt. An ordinary 429 case and invalid or wider header controls retained at most two attempts.

### Browser guard and spec wiring

RED evidence:

- `npx vitest run tests/unit/scripts/paid-smoke-guard.test.ts` failed before the guard module existed.
- `npx vitest run tests/unit/scripts/paid-smoke-spec-contract.test.ts` failed three tests before the paid smoke spec existed.

GREEN command:

`npx vitest run tests/unit/scripts/paid-smoke-guard.test.ts tests/unit/scripts/paid-smoke-spec-contract.test.ts`

Observed GREEN: 2 files and 9 tests passed. The checks cover exact opt-in, serial mode, Playwright retries zero, independent per-test counters, pre-network abort and attempt-header injection.

Final mocked verification command:

`npx vitest run tests/contract/routes/runs-route.test.ts tests/contract/providers/live-provider-runtime.test.ts tests/unit/scripts/paid-smoke-guard.test.ts tests/unit/scripts/paid-smoke-spec-contract.test.ts`

Observed: 4 files and 60 tests passed. This includes route-level transient failure coverage and AI SDK `maxRetries: 0` coverage without a real provider call.

## Default-safe smoke result

Command:

`npx playwright test tests/e2e/live-production-smoke.spec.ts --workers=1 --retries=0`

Observed without `RUN_PAID_SMOKE=1`: 2 skipped. No browser context was created and zero `POST /api/runs` submissions occurred.

## Typecheck

Command:

`npm run typecheck`

Observed: both TypeScript projects completed successfully.

Formatting checks passed for all changed files. `npm run lint` completed with no findings.

## Paid and operational activity

Zero paid calls were made. No provider endpoint was called. No secret was inspected. No migration was applied. No deployment was performed. No connected run ID or provider outcome was recorded. No merge, push or tag movement was performed.

Task 8 steps 3 through 10 remain deferred until Task 8 review and final whole-branch review.

## Task 8 review fix round 1

The Important review finding was reproduced and fixed with strict TDD.

RED command:

`npx vitest run tests/unit/scripts/paid-smoke-guard.test.ts tests/unit/scripts/paid-smoke-spec-contract.test.ts`

Observed RED: 2 tests failed. The named-header helper was absent and the paid spec still collected the complete header map through `allHeaders()`.

GREEN command:

`npx vitest run tests/unit/scripts/paid-smoke-guard.test.ts tests/unit/scripts/paid-smoke-spec-contract.test.ts`

Observed GREEN: 2 files and 11 tests passed. The paid spec now reads only `x-provider-attempt-limit` through `headerValue()`. A focused regression plants unrelated cookie and authorization sentinels then proves a failed marker assertion includes neither value and never calls `allHeaders()`.

The opt-in, independent request counters, pre-network second-request abort, server attempt cap, AI SDK retry cap and provider acceptance assertions remain unchanged. Zero paid calls were made. No provider endpoint, migration, deployment, merge, push, credential or tag was touched.

Final bounded verification passed 4 mocked files with 62 of 62 tests. Typecheck completed both TypeScript projects. Lint and changed-file formatting passed. The paid Playwright spec ran without opt-in and reported 2 skipped with zero `POST /api/runs` submissions.
