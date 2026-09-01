# Task 7 report: documentation, mocked verification and release checkpoint

## Outcome

- Updated the public release documentation and both maintained contracts for the durable live-processing and source-origin behavior from Tasks 5 and 6.
- Extended the public-surface scanner to reject provider API key patterns, SHA-256 or document digest exposure, sample-origin manifest entries, deletion tokens and system prompt leakage. Ordinary safe run IDs remain allowed.
- Preserved the visual identity and all design tokens.
- Made zero paid provider calls. The built-in OpenAI GPT-5.6 Luna observation and the custom unverified Anthropic Claude Haiku 4.5 observation remain pending connected-production checks.

## Documented release contract

- The two explicit buttons are `Run live document review` and `Assess sample without AI processing`.
- Source display is bounded to `Original demo document`, `Exact copy of a demo document` and `Source unverified`.
- Exact SHA-256 matching proves byte equality with a committed synthetic sample only. It does not prove authorship, authenticity, fraud status or malware safety.
- Screenshots, re-encodings, edits and unrelated supported files are processed as `Source unverified`. Origin classification does not reject them. A person must review them and the posting handoff action remains unavailable.
- Operations source counts cover the whole repository while the detail table remains bounded to the newest 100 records.
- One deliberate reviewer click on `Run live document review` is the paid-call boundary. Model selection alone never dispatches.
- Workflow truth remains `Prepared only - not sent`. ERP posting, payment, inventory, email and archive connectors remain simulated.
- Recommended defaults are GPT-5.6 Luna and Claude Haiku 4.5. Pricing is dated 2026-09-01. The GPT-5.6 long-context tier applies above 272,000 input tokens at 2x input and 1.5x output pricing across the full request.
- The derived US$8.46 default budget rounds the maximum supported two-call reservation of US$8.456. It is a conservative reservation ceiling rather than expected spend.

## TDD evidence

- RED: `npx vitest run tests/unit/scripts/public-surface.test.ts tests/unit/scripts/release-documentation.test.ts` failed four new assertions before the documentation and scanner implementation.
- GREEN: the same focused command passed 24 tests after implementation.
- Release-artifact alignment: the final expanded focused command `npx vitest run tests/unit/scripts/public-surface.test.ts tests/unit/scripts/release-documentation.test.ts tests/unit/scripts/release-artifacts.test.ts` passed 34 tests.
- The public scanner tests cover API keys, deletion tokens, document digests, manifest entries and system prompt data. A regression fixture proves an ordinary safe run ID passes.

## Full mocked verification matrix

The matrix was run in the required order with no live provider calls.

1. `npm run format:check` initially reported tracked drift in 11 paths. The canonical `npm run format` command was applied and every changed path was reviewed. The restarted gate passed.
2. `npm run lint` passed with no ESLint findings.
3. `npm run typecheck` passed both application and contract TypeScript checks.
4. `npm test` exposed stale release assertions for the explicit recorded-mode label and migration 0010. Those assertions were updated. One later route-test timeout passed in isolation without a product change. After the final recorder alignment the full suite passed 51 files and 620 tests.
5. `npm run test:e2e -- --workers=1` exposed stale button names plus missing `operations.origin` and per-run `sourceOriginStatus` fields in mocked fixtures. The labels and fixtures were aligned without removing a scenario or weakening an assertion. The restarted suite passed 37 Chromium tests.
6. `npm run build` passed with Next.js 16.3.3 and all routes generated.
7. `npm run verify:premium` passed in strict mode with zero findings.
8. `npm run audit:dependencies` passed with zero vulnerabilities.
9. `git diff --check` passed.

Additional contract gate: `npm run design:lint` completed with zero errors, nine orphaned-token warnings and one token-summary information item. No token was removed or changed.

## Local built-app public verification

- Started the built application on `127.0.0.1:3000` with `AI_LIVE_ENABLED=false` and `ALLOW_IN_MEMORY_PERSISTENCE=true` set explicitly for that process.
- Removed the OpenAI and Anthropic key variables from that process without reading or inheriting their values.
- `npm run verify:public -- http://127.0.0.1:3000` reported `Public-surface verification passed for local artifacts and origin.`
- Stopped the process after verification and confirmed port 3000 was no longer listening.

## Rollback checkpoint

- Created `pre-live-source-origin-20260901` because it was absent.
- Verified that it resolves exactly to `4a17bcfe1af105e847234b59e3ec13f57b454d1f` with subject `docs: specify live processing and source origin`.

## Boundaries observed

- Did not inspect secrets, apply migration 0010, deploy, merge or push.
- Preserved user-owned output and temporary paths.
- Kept mocked acceptance separate from connected production observations.
