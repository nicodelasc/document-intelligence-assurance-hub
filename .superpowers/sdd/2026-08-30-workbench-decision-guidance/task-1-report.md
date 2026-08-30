# Task 1 Report: Server-owned relevance guardrail

## Implementation summary

- Added the provider document classification contract: `supplier_invoice`, `warehouse_goods_receipt`, `irrelevant` and `uncertain`.
- Recorded fixtures now classify as their fixture family. The live structured prompt includes the classification contract and uses `document-extraction-2026-08-30.v3`.
- Custom `irrelevant` and `uncertain` documents now force `not_found`, persist classification in the existing detailed result JSON and replace the entire provider proposal with server-owned blocked action data. Its visible brief is exactly: `This does not appear to be a supported supplier invoice or warehouse goods receipt. No workflow action was prepared.`
- Guarded documents authorize only `replace_document` and `download_summary`. The workflow route reads the persisted detailed classification before enforcing this policy.
- Active public run details expose persisted classification while list rows and legacy detailed results remain compatible.

## Files changed

- Production: `src/domain/types.ts`, `src/domain/action-policy.ts`, `src/domain/workflow-actions.ts`, `src/server/workflow/provider.ts`, `src/server/workflow/recorded-provider.ts`, `src/server/workflow/live-provider.ts`, `src/server/workflow/execute-run.ts`, `src/server/repositories/run-repository.ts`, `src/server/http/public-serialization.ts` and `src/server/http/workflow-action-handler.ts`.
- Tests: provider contracts and runtime mocks, public serialization, run route mocks, workflow route authorization, action policy, workflow policy and execute-run coverage.

## TDD evidence

Each production behavior was preceded by a focused failing test and a focused green rerun.

- Provider contract RED: schema rejected the new `classification` key and recorded fixtures returned `undefined`. GREEN: `npx vitest run tests/contract/providers/provider-contract.test.ts` passed 43 tests.
- Workflow policy RED: guarded documents returned the old five `not_found` controls. GREEN: `npx vitest run tests/unit/domain/workflow-actions.test.ts` passed 30 tests.
- Action replacement RED: provider proposal fields survived. GREEN: `npx vitest run tests/unit/domain/action-policy.test.ts` passed 5 tests.
- Outcome enforcement RED: guarded custom runs completed as `evidence_consistent`. GREEN: `npx vitest run tests/unit/server/execute-run.test.ts -t "forces a custom"` passed 2 tests.
- Serialization RED: active detail omitted `documentClassification`. GREEN: `npx vitest run tests/contract/routes/public-serialization.test.ts` passed 14 tests.
- Route authorization RED: `prepare_email` returned HTTP 200 for guarded runs. GREEN: `npx vitest run tests/contract/routes/workflow-actions-route.test.ts` passed 25 tests.
- Runtime adapter mock update: `npx vitest run tests/contract/providers/live-provider-runtime.test.ts` passed 9 tests.

## Verification

- `npm run typecheck` passed.
- Final full Vitest command: `npm test`.
- Final result: 46 test files passed and 536 tests passed.
- An earlier full-suite run exposed a complete SDK mock missing the newly required classification. The mock was updated and the final full suite passed.

## Self-review and concerns

- Reviewed the diff with `git diff --check`; no whitespace errors were reported.
- The guardrail remains server-owned: provider status is overwritten, staged timestamps are cleared, action allowlists derive from persisted classification and action data is replaced in full for guarded custom documents.
- Existing detailed results without a classification still serialize without the new field, so no persistence migration is required for the JSON result payload.
- No live provider credentials were read or used.
- Concerns: none.

## Fix round 1: Review findings

### Finding 1: Active public classification must have only four values

- Changed `SaveRunResultsInput.documentClassification` to allow only the four-value classification union when present. Legacy result payloads are still treated as untrusted at serialization and a `null` value is omitted rather than exposed.
- Added public contract coverage for a legacy detailed result containing `documentClassification: null`.
- RED command: `npx vitest run tests/contract/routes/public-serialization.test.ts -t "omits a legacy null classification"`.
- RED result: expected the serialized detail not to have `documentClassification` but received `null`.

### Finding 2: Guarded classification must override failed-run recovery actions

- Moved the guarded `irrelevant` and `uncertain` classification policy ahead of the failed-run action branch.
- Added unit coverage for guarded failed runs and route coverage proving `retry_processing` is denied even when a persisted detailed result has guarded classification.
- RED command: `npx vitest run tests/unit/domain/workflow-actions.test.ts -t "limits a failed guarded"`.
- RED result: received `retry_processing` and `download_summary` instead of `replace_document` and `download_summary`.
- RED command: `npx vitest run tests/contract/routes/workflow-actions-route.test.ts -t "denies retry processing for a failed guarded"`.
- RED result: route returned HTTP 200 instead of HTTP 409.

### Green verification

- Green command: `npx vitest run tests/contract/routes/public-serialization.test.ts tests/unit/domain/workflow-actions.test.ts tests/contract/routes/workflow-actions-route.test.ts`.
- Green result: 3 test files and 74 tests passed.
- Files changed: `src/server/repositories/run-repository.ts`, `src/server/http/public-serialization.ts`, `src/domain/workflow-actions.ts`, `tests/contract/routes/public-serialization.test.ts`, `tests/unit/domain/workflow-actions.test.ts` and `tests/contract/routes/workflow-actions-route.test.ts`.
- Concerns: none. The serializer safely omits invalid legacy `null` while the persisted current contract permits only valid classifications.
- Typecheck command: `npm run typecheck`.
- Typecheck result: passed.
- Full Vitest command: `npm test`.
- Full Vitest result: 46 test files and 541 tests passed.
