# Evaluation report

## Recorded benchmark result

The verified suite replays three document fixtures across both provider selections. That produces six deterministic recorded contract runs.

| Fixture                       | OpenAI selection | Anthropic selection | Expected assurance outcome |
| ----------------------------- | ---------------- | ------------------- | -------------------------- |
| Invoice exception packet      | Recorded replay  | Recorded replay     | Needs review               |
| Warehouse receiving sheet     | Recorded replay  | Recorded replay     | Clear                      |
| Visitor access request        | Recorded replay  | Recorded replay     | Incomplete                 |

Recorded false-clear count: **0**.

This result is driven by the checked-in fixture outcomes and action statuses: needs review, ready and blocked. It demonstrates fixture routing, schema conformance, field evaluation and deterministic decision behavior. It does not measure live model accuracy, production reliability or financial impact. No live provider request was made for this report.

## Keyless production verification — 2026-08-28

| Check                 | Result | Evidence boundary                                                                                                                                                                                 |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable public routes  | Passed | Workbench, Operations, metrics, run list, active trace and document preview returned their expected public responses.                                                                             |
| Recorded browser flow | Passed | Playwright completed 16 of 16 deployed tests across desktop, mobile, keyboard, accessibility, comparison and failure recovery paths.                                                              |
| Recorded benchmark    | Passed | Six fixture-provider combinations produced exact match 1.0, missing-field recall 1.0, evaluator agreement 1.0 and zero false Clears.                                                              |
| Durable persistence   | Passed | Neon reported migrations `0001` through `0006` exactly once with the required tables and quota functions. Private Blob served active PDF bytes through the application only.                      |
| Delete now            | Passed | One recorded uploader receipt returned 202 on deletion then its document route returned 410. The raw deletion token was not logged.                                                               |
| Expiry and cleanup    | Passed | One exact synthetic run was moved past expiry. Detail metadata remained available, document access returned 410, authorized purge returned 200 and the cleanup backlog for that run reached zero. |
| Public-surface scan   | Passed | The deployed origin exposed no credential-shaped value, raw deletion hash, internal storage locator, hidden reasoning property, full prompt text or unsupported impact claim.                     |
| Runtime logs          | Passed | Vercel reported no error-level entry and no 5xx request during the verified release window.                                                                                                       |
| Credential gate       | Passed | `AI_LIVE_ENABLED=false`; `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` were absent. Input tokens, output tokens and estimated model cost remained zero.                                                |

These results verify the recorded keyless production path. They do not replace the live-provider acceptance gate below.

## Pending live acceptance

Every item remains pending until Nicholas explicitly authorizes model keys for a controlled acceptance session.

| Acceptance item                 | Status  | Pass evidence required                                                                            |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| One real OpenAI run             | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| One real Anthropic run          | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| Deliberate live failure         | Pending | Safe mapped error, no provider body leak, no false completion and correct reservation handling    |
| Production retention simulation | Pending | Expired read denied before purge, durable tombstone, Blob retry evidence and zero detail recovery |

Live mode must remain disabled until all four rows pass in the intended production configuration.
