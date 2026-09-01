# Evaluation report

## Reference quality suite

The public Reference quality suite contains exactly 10 provider-neutral observations. Each observation is a checked-in document reference with deterministic field values, comparison truth, an expected assurance outcome and an expected action status.

| Family                  | Reference                | Classification  | Expected outcome | Expected action status |
| ----------------------- | ------------------------ | --------------- | ---------------- | ---------------------- |
| Supplier invoice        | Clean match              | Correct         | Clear            | Ready                  |
| Supplier invoice        | Buyer hold               | Needs attention | Needs review     | Needs review           |
| Supplier invoice        | Unreadable approval      | Needs attention | Incomplete       | Blocked                |
| Supplier invoice        | Total mismatch           | Incorrect       | Needs review     | Needs review           |
| Supplier invoice        | PO and currency mismatch | Incorrect       | Needs review     | Needs review           |
| Warehouse goods receipt | Clean receipt            | Correct         | Clear            | Ready                  |
| Warehouse goods receipt | Quantity correction      | Needs attention | Needs review     | Needs review           |
| Warehouse goods receipt | Unreadable damage note   | Needs attention | Incomplete       | Blocked                |
| Warehouse goods receipt | Quantity mismatch        | Incorrect       | Needs review     | Needs review           |
| Warehouse goods receipt | Item and lot mismatch    | Incorrect       | Needs review     | Needs review           |

The reference totals are:

- 5 supplier invoices and 5 warehouse goods receipts
- 2 Correct, 4 Needs attention and 4 Incorrect classifications
- 2 Clear, 6 Needs review and 2 Incomplete expected outcomes
- 2 of 2 unreadable critical fixtures detected
- Zero false-clear results

Typed business evidence remains native PDF text. Reviewer and receiver comments are raster images so their handwriting is not available as selectable comment text. Unclear critical handwriting is represented as missing evidence and must resolve as Not found rather than a guessed value.

The two approved handwriting fixtures are fail-closed. If visual evidence is decoded and conflicts with the trusted synthetic reference then the result is Needs review and appears as `Exception review required`. If the evidence cannot be decoded confidently then the result is Incomplete and appears as `Awaiting readable evidence`. Neither path may produce a clear result. The reference suite retains zero false-clear results.

Live synthetic processing uses explicit visual grounding for these fixtures. A validated text-native page is rendered for bounded local OCR then native text and OCR text are merged for page-scoped checks. Recorded synthetic runs retain their deterministic outcome and do not invoke OCR or a provider. This distinction verifies the grounding contract without turning recorded cases into provider observations.

This suite demonstrates fixture routing, schema conformance, deterministic field evaluation and action policy. It is a provider-neutral contract baseline. Fallback observations make no provider claim. It does not measure provider accuracy, production reliability or financial impact.

## Recorded-adapter schema and configuration coverage

A separate 10 by 2 contract matrix contains 20 adapter contract cases. Every reference is checked once through the OpenAI configuration and once through the Anthropic configuration against the shared structured-result schema.

| Configuration              | Cases | What the cases establish                                                               |
| -------------------------- | ----: | -------------------------------------------------------------------------------------- |
| OpenAI recorded adapter    |    10 | Catalogue routing, field ordering, schema validation and deterministic action equality |
| Anthropic recorded adapter |    10 | Catalogue routing, field ordering, schema validation and deterministic action equality |
| Total                      |    20 | Schema and configuration coverage only                                                 |

These cases make no provider request, consume no provider tokens and carry no provider result attribution. They are not additional observations in the Reference quality suite. They cannot be doubled into 20 provider observations or treated as provider acceptance.

Operations displays exactly 10 provider-neutral observations as one Reference quality suite. It reports the family, classification, outcome and unreadable-detection counts from those fixed references. Zero false clears is a deterministic fixture result rather than provider acceptance. The 20 adapter contract cases remain separate schema and configuration coverage.

## Processing-route behavior and acceptance

Enabled built-in samples use the selected model route. The available route uses `Run live document review` and one deliberate reviewer click is the paid-call boundary. If the selected provider is unavailable a built-in sample uses `Assess sample without AI processing` then states `Sample results - no AI processing`. Custom uploads have no fallback. The unavailable selected model is disabled for custom processing and the interface states `Processing unavailable for this model`.

Only a live submission can reserve model budget. Persisted `providerDispatched=true` is the only proof used to report that a provider request was dispatched. `/api/models` exposes catalogue data, defaults and provider-availability booleans while provider keys remain server-side.

Mocked acceptance evidence is separate from connected production observations. Zero paid calls have been made. The two-call acceptance boundary remains pending:

| Connected production observation  | Status  | Required evidence                                                                                       |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| OpenAI GPT-5.6 Luna built-in      | Pending | One selected built-in sample with confirmed dispatch, grounded evidence, deterministic outcome and cost |
| Anthropic Claude Haiku 4.5 custom | Pending | One consented upload with `Source unverified`, confirmed dispatch, no fallback and no posting handoff   |

Neither observation may retry automatically. A failure requires diagnosis and fresh approval before another paid call. `Prepared only - not sent` remains the workflow truth because real email and external business-system connectors are out of scope.

## Source-origin evidence boundary

The public labels are `Original demo document`, `Exact copy of a demo document` and `Source unverified`. Exact SHA-256 matching proves byte equality with a committed synthetic sample only. It does not prove authorship, authenticity, fraud status or malware safety. Screenshots, re-encodings, edits and unrelated supported files are processed as `Source unverified`. They are not rejected by origin classification and require a person before any posting handoff. Mocked component, contract and browser coverage establishes that unverified evidence cannot expose posting preparation. It does not establish connected provider acceptance.

## Task 7 mocked release checkpoint — 2026-09-01

This checkpoint used mocked providers and keyless local execution. Zero paid calls have been made. It remains separate from the two connected production observations above.

| Gate                 | Result               | Fresh evidence                                                                                                                                                                                                                                                |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format               | Passed               | `npm run format:check` passed after the canonical formatter aligned tracked files.                                                                                                                                                                            |
| Lint                 | Passed               | `npm run lint` completed with no findings.                                                                                                                                                                                                                    |
| Typecheck            | Passed               | `npm run typecheck` completed both TypeScript projects.                                                                                                                                                                                                       |
| Vitest               | Passed               | `npm test` completed 51 files with 620 of 620 tests passing. One earlier full-suite run hit a five-second timing limit. The isolated test passed in 1.63 seconds and the unchanged suite passed on restart.                                                   |
| Browser matrix       | Passed               | `npm run test:e2e -- --workers=1` completed 37 of 37 Chromium checks with one worker.                                                                                                                                                                         |
| Production build     | Passed               | `npm run build` compiled Next.js 16.3.3 and produced all declared routes.                                                                                                                                                                                     |
| Premium strict audit | Passed               | `npm run verify:premium` reported zero errors, warnings, violations or unresolved findings.                                                                                                                                                                   |
| Dependency audit     | Passed               | `npm run audit:dependencies` reported zero vulnerabilities.                                                                                                                                                                                                   |
| Patch whitespace     | Passed               | `git diff --check` reported no whitespace errors.                                                                                                                                                                                                             |
| DESIGN lint          | Passed with warnings | `npm run design:lint` reported zero errors, nine orphaned-token warnings and one token summary. Visual tokens were unchanged.                                                                                                                                 |
| Local public surface | Passed               | The built app ran with provider credentials removed, `AI_LIVE_ENABLED=false` and `ALLOW_IN_MEMORY_PERSISTENCE=true`. `npm run verify:public -- http://127.0.0.1:3000` scanned local artifacts and the local origin successfully then the process was stopped. |

The public-surface verifier rejects API-key patterns, SHA-256 or document-digest exposure, manifest entries, deletion tokens and system prompt leakage. Its regression case permits ordinary safe run IDs.

## Dated Task 6 verification baseline — 2026-08-29

The table below is a historical baseline, not the current final suite. It records only commands run after the ten-reference documentation and public-surface contract were implemented on 2026-08-29.

| Gate                        | Result | Fresh evidence                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check                | Passed | `npm run format:check` reported that every matched file uses Prettier code style.                                                                                                                                                                                                                        |
| Lint                        | Passed | `npm run lint` exited zero with no errors. It reported two existing unused-variable warnings in `tests/contract/providers/provider-contract.test.ts`.                                                                                                                                                    |
| Typecheck                   | Passed | `npm run typecheck` completed the application and contract TypeScript projects with exit zero.                                                                                                                                                                                                           |
| Unit tests                  | Passed | `npm run test:unit` completed 21 files with 231 of 231 tests passing.                                                                                                                                                                                                                                    |
| Component tests             | Passed | `npm run test:component` completed two files with 43 of 43 tests passing.                                                                                                                                                                                                                                |
| Contract tests              | Passed | `npm run test:contract` completed 19 files with 182 of 182 tests passing. The 20 recorded-adapter cases remain configuration and schema coverage only.                                                                                                                                                   |
| Full Vitest baseline        | Passed | `npm test` completed 42 files with 456 of 456 tests passing.                                                                                                                                                                                                                                             |
| Accessibility               | Passed | `npm run test:a11y` completed five of five Chromium checks across desktop, mobile and source-order coverage.                                                                                                                                                                                             |
| Production build            | Passed | `npm run build:production` compiled Next.js 16.3.3 and generated all six static pages plus the declared dynamic API routes.                                                                                                                                                                              |
| Public-surface verification | Passed | `npm run verify:public` scanned local source and built artifacts with zero findings. The verifier rejects the three exact retired phrases, requires the current Processing model and Reference quality suite labels from the aggregated UI source and includes `/api/models` in configured-origin scans. |

No API key was supplied to these historical gates and no provider call was made. The historical baseline is mocked evidence only. Both connected observations remain Pending.

All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed.
