# Task 1 report: Domain catalogues and action policy

## Status

Implemented the server-owned model catalogue, neutral document fixture catalogue, deterministic action policy and catalogue-backed pricing helpers. No API keys were used.

## Controller ruling

Used the controller-supplied server-owned values dated 2026-08-28:

- `gpt-5.6-luna`: 1,050,000 context tokens, $0.20 input per million tokens, $1.20 output per million tokens and recommended.
- `gpt-5.6-terra`: 1,050,000 context tokens, $2.00 input per million tokens, $12.00 output per million tokens and not recommended.
- `claude-haiku-4-5`: 200,000 context tokens, $1.00 input per million tokens, $5.00 output per million tokens and recommended.
- `claude-sonnet-5`: 1,000,000 context tokens, $2.00 input per million tokens, $10.00 output per million tokens and not recommended.

The existing 2,000-token maximum output policy and two-attempt policy remain unchanged.

## Files changed

- `src/domain/live-model-catalog.ts`
- `src/domain/action-policy.ts`
- `src/domain/types.ts`
- `src/domain/pricing.ts`
- `src/domain/fixtures.ts`
- `tests/unit/domain/live-model-catalog.test.ts`
- `tests/unit/domain/action-policy.test.ts`
- `tests/unit/domain/fixtures.test.ts`
- `tests/unit/domain/pricing.test.ts`
- `.superpowers/sdd/2026-08-28-document-to-action-redesign/task-1-report.md`

## Tests run

- Red: `npm run test:unit -- tests/unit/domain/live-model-catalog.test.ts` failed as expected because `@/domain/live-model-catalog` did not exist.
- Red: `npm run test:unit -- tests/unit/domain/action-policy.test.ts tests/unit/domain/fixtures.test.ts` failed as expected because the action policy module and neutral fixtures did not exist.
- Red: `npm run test:unit -- tests/unit/domain/live-model-catalog.test.ts` failed as expected after adding the dated metadata assertions because the initial catalogue values did not match the controller ruling.
- Red: `npm run test:unit -- tests/unit/domain/pricing.test.ts` failed as expected after changing pricing expectations because the prior pricing table still served legacy model IDs and rates.
- Green: `npx vitest run tests/unit/domain/live-model-catalog.test.ts tests/unit/domain/action-policy.test.ts tests/unit/domain/fixtures.test.ts tests/unit/domain/pricing.test.ts` passed: 4 files and 14 tests.
- Green: `npm run typecheck` passed: both application TypeScript and contract TypeScript checks completed successfully.

## Self-review notes

- `liveModelCatalog` and each definition are frozen at runtime.
- Provider-model mismatches fail closed with `unsupported_live_model`.
- Pricing calculations now use catalogue definitions and preserve the maximum-output plus attempt safeguards.
- Fixture policy ignores a model-proposed action for trusted fixtures then returns the trusted fixture action with a verified status. Custom documents remain review-required except incomplete evidence which blocks staging.
- Legacy invoice exports remain temporarily for the unmodified request parser, recorded provider and Workbench. Tasks 2 through 4 are responsible for moving those consumers to `syntheticFixtures`.

## Concerns

- The requested `npm run test:unit -- ...` invocation runs the entire `tests/unit` directory because of the script's positional `tests/unit` argument. After the new high-cost catalogue entries it reports 24 legacy quota and workflow failures because their fixed assumptions use the old global maximum reservation. The dedicated four-file command passes. Task 2 should make quota reservation model-specific as planned then update those legacy tests.
- No sample PDFs were added in this task. Task 3 must create the files named by the new neutral fixtures before runtime sample selection is migrated.

## Fix round 1 of 5

### Findings addressed

- Live quota reservation is now derived from the model created for the request. The default fallback reservation is the larger recommended-provider maximum of $0.424 rather than the $4.032 catalogue-wide maximum. A selected higher-cost model still reserves its own full maximum and is correctly denied when the daily budget cannot cover it.
- OpenAI live providers now default to the enabled `gpt-5.6-luna` catalogue entry. Recorded providers use the catalogue default and validate every supplied override against the selected provider.

### Files changed

- `src/domain/pricing.ts`
- `src/server/http/runs-handler.ts`
- `src/server/security/rate-limit.ts`
- `src/server/workflow/live-provider.ts`
- `src/server/workflow/recorded-provider.ts`
- `tests/unit/domain/pricing.test.ts`
- `tests/unit/server/rate-limit.test.ts`
- `tests/unit/server/execute-run.test.ts`
- `tests/contract/providers/provider-contract.test.ts`
- `tests/contract/providers/live-provider-runtime.test.ts`
- `tests/contract/routes/container.test.ts`
- `tests/contract/routes/runs-route.test.ts`

### Commands and exact results

- Red: `npx vitest run tests/unit/domain/pricing.test.ts tests/unit/server/rate-limit.test.ts tests/contract/providers/provider-contract.test.ts` reported 23 failures before the correction. The new default reservation was denied under the $4.032 global floor and the OpenAI default was rejected as unsupported.
- Green: `npx vitest run tests/unit/domain/pricing.test.ts tests/unit/server/rate-limit.test.ts tests/unit/server/execute-run.test.ts tests/contract/providers/provider-contract.test.ts` passed: 4 files and 94 tests.
- Green: `npx vitest run tests/contract/providers/live-provider-runtime.test.ts tests/contract/routes/container.test.ts tests/contract/routes/runs-route.test.ts` passed: 3 files and 55 tests.
- Green: `npm test` passed: 34 files and 296 tests.
- Green: `npm run typecheck` passed.

### Self-review and concerns

- Provider construction completes before quota reservation without any provider call. This allows the quota to reserve the exact server-validated model maximum.
- The legacy `MAX_SUPPORTED_LIVE_RUN_COST_USD` remains a correct catalogue-wide ceiling for callers that need the largest possible model cost. Runtime quota admission no longer uses it as a floor.
- A higher-cost selected model can legitimately be unavailable under the existing $3.00 daily public budget. That is a safe budget decision rather than a default-model outage.
