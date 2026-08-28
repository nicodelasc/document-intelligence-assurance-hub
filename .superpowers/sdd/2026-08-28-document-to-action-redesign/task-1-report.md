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
