# Evaluation report

## Recorded benchmark result

The verified suite replays three synthetic fixtures across both provider selections. That produces six deterministic recorded contract runs.

| Fixture                       | OpenAI selection | Anthropic selection | Expected assurance outcome |
| ----------------------------- | ---------------- | ------------------- | -------------------------- |
| Clean invoice                 | Recorded replay  | Recorded replay     | Clear                      |
| Invoice-total mismatch        | Recorded replay  | Recorded replay     | Needs review               |
| Missing purchase-order number | Recorded replay  | Recorded replay     | Incomplete                 |

Recorded false-clear count: **0**.

This result demonstrates fixture routing, schema conformance, field evaluation and deterministic decision behavior. It does not measure live model accuracy, production reliability or financial impact. No live provider request was made for this report.

## Pending live acceptance

Every item remains pending until Nicholas explicitly authorizes model keys for a controlled acceptance session.

| Acceptance item                 | Status  | Pass evidence required                                                                            |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| One real OpenAI run             | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| One real Anthropic run          | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| Deliberate live failure         | Pending | Safe mapped error, no provider body leak, no false completion and correct reservation handling    |
| Production retention simulation | Pending | Expired read denied before purge, durable tombstone, Blob retry evidence and zero detail recovery |

Live mode must remain disabled until all four rows pass in the intended production configuration.
