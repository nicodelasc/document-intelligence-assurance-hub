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

Enabled built-in samples use the selected model route. If the selected provider is unavailable a built-in sample uses the deterministic result and states `Sample results - no AI processing`. Custom uploads have no fallback. The unavailable selected model is disabled for custom processing and the interface states `Processing unavailable for this model`.

Only `Assess for exceptions` can reserve model budget. Persisted `providerDispatched=true` is the only proof used to report that a provider request was dispatched. `/api/models` exposes catalogue data, defaults and provider-availability booleans while provider keys remain server-side.

Configuration is not acceptance. All four processing routes remain pending until their own connected production smoke tests pass:

| Processing route                  | Status  | Required evidence                                                               |
| --------------------------------- | ------- | ------------------------------------------------------------------------------- |
| Built-in sample through OpenAI    | Pending | Selected model, confirmed dispatch, grounded evidence and deterministic outcome |
| Built-in sample through Anthropic | Pending | Selected model, confirmed dispatch, grounded evidence and deterministic outcome |
| Custom upload through OpenAI      | Pending | Consented upload, confirmed dispatch, grounded evidence and no fallback         |
| Custom upload through Anthropic   | Pending | Consented upload, confirmed dispatch, grounded evidence and no fallback         |

A deliberate provider failure and a connected retention simulation also remain pending. Real email and external business-system connectors are out of scope.

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

No API key was supplied to these gates and no provider call was made. The four production processing routes remain Pending.

All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed.
