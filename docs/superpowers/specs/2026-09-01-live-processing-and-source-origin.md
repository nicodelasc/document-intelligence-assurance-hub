# Live Processing and Source-Origin Review

## Status

Approved in chat by Nicholas on 2026-09-01. This specification activates the existing direct OpenAI and Anthropic paths after server-only credentials are available. It also adds a deterministic source-origin status without blocking useful OCR and extraction for screenshots, scans or re-exported documents.

## Problem statement

The current Workbench can route a deliberately submitted run to a live provider but the deployed interface still reflects keyless availability until it is redeployed. Reviewers also cannot see clearly whether a run will call a paid model before they press the primary action.

Custom uploads need an honest source boundary. A byte comparison can prove that an upload exactly matches a committed synthetic document. It cannot prove authorship, business authenticity or absence of tampering in an arbitrary document. The product must expose that distinction without pretending that AI can detect forgery.

## Goals

- Make selected live-provider availability and intended execution visible before submission.
- Keep every provider call behind one deliberate reviewer click.
- Process screenshots, scans, edited files and unrelated supported uploads through the selected live model when quota is available.
- Label source origin separately from extracted evidence quality.
- Prevent an unverified source from reaching posting preparation while preserving useful manual-review actions.
- Keep confirmed provider use, token counts, estimated cost and origin status reviewable in Operations.
- Use mocked provider responses for all development checks then make at most one final paid smoke call per configured provider.

## Non-goals

- Proving that a business document is legally genuine.
- Detecting fraud, malware or fabricated content with an AI classifier.
- Perceptual image matching or fuzzy screenshot recognition.
- Automatically approving payment, posting inventory or changing an external system.
- Sending email.
- Automatically retrying a paid smoke call.

## Source-origin model

Add a server-owned `SourceOriginStatus` with three values:

| Stored value | Reviewer label | Meaning |
| --- | --- | --- |
| `server_original` | `Original demo document` | The server selected and loaded a committed synthetic fixture. No document bytes came from the browser. |
| `recognized_copy` | `Exact copy of a demo document` | A custom upload has the same SHA-256 digest as one committed synthetic fixture. This proves byte equality only. |
| `unverified` | `Source unverified` | The custom upload is not byte-identical to a committed fixture. It may still be processed. |

The server owns a digest manifest for the committed files under `public/samples`. A drift test must fail if a protected sample changes without an intentional manifest update.

Custom-file validation keeps the current file signature, MIME, size, page-count, field-count and consent checks. After those checks pass the server computes a SHA-256 digest and compares it with the manifest. This happens before provider construction and quota reservation. The digest itself stays server-side.

A screenshot, phone scan, crop, metadata change, PDF rewrite or image re-encoding normally produces a different digest. It therefore receives `Source unverified` and continues through live processing. The product must not add fuzzy matching or block the run merely because the digest differs.

## Live execution and cost controls

The server remains authoritative for execution mode:

- A configured provider requires `AI_LIVE_ENABLED=true` plus its server-only API key.
- A deliberate Workbench submission uses the selected live provider when that provider is available.
- A built-in sample falls back to its deterministic result only when the selected provider is unavailable.
- A custom upload has no deterministic fallback.
- Loading the page, selecting a file, changing a model, opening a preview and using a tour never calls a provider.
- The SDK keeps automatic retries disabled for the paid request.
- The existing browser limits, custom-upload limits, idempotency claim and global daily budget remain enforced.

The recommended cheapest catalogue models remain GPT-5.6 Luna and Claude Haiku 4.5. The dated pricing catalogue must be refreshed from official provider documentation during implementation. The interface shows model rates as estimates and Operations continues to calculate confirmed run cost from trustworthy returned usage.

## Workbench experience

The current model dropdown remains grouped by provider. The selected model area adds:

- a visible `Live AI processing` or `Sample result - no AI processing` status
- the selected provider and model
- `Recommended for cost` on the preferred model for each provider
- dated input and output pricing
- a short note that final estimated run cost appears after confirmed provider dispatch

The primary action remains one deliberate click. Its label reflects the execution target:

- `Run live document review` when the selected provider is available
- `Assess sample without AI processing` for an unavailable-provider synthetic sample
- disabled `Processing unavailable for this model` for an unavailable-provider custom upload

The completed result shows the source-origin label near the review outcome. The trace remains a three-stage reviewer summary. It may show confirmed elapsed review time but must not present equal-split client timing as measured server step duration.

## Outcome and workflow policy

Source origin does not rewrite extracted field values or evidence labels. Custom outcomes remain `Evidence-consistent`, `Conflict` or `Not found`.

`server_original` keeps the fixture-aware action policy. `recognized_copy` may use the current custom-evidence policy because its bytes exactly match a committed synthetic document.

`unverified` is always a human-review boundary:

- It can show OCR, extracted values, evidence, document classification and field evaluator results.
- `Evidence-consistent` is downgraded from posting-ready to manual review for action purposes.
- `approve_and_stage` is never allowed.
- `assign_review`, clarification-email preparation, clearer-document requests and replacement remain available when allowed by the outcome.
- Irrelevant or uncertain documents remain restricted to replacement.
- Prepared email remains response-only and clearly labelled `Prepared only - not sent`.

The result panel explains that source status and evidence consistency answer different questions. Consistent extraction from an unverified source does not make that source authentic.

## Operations experience

Operations continues to count provider use only after durable `providerDispatched=true` attribution. It adds source-origin status to the review queue and selected-run inspector. Aggregate cards show:

- original demo runs
- exact-copy uploads
- unverified uploads

The run inspector keeps confirmed provider, model, token, cost, latency and safe diagnostic data separate from configured selections. No API key, document digest, deletion token, hidden prompt or hidden reasoning is exposed.

## Persistence and interfaces

Persist `source_origin_status` on each run through one additive database migration. The public run summary and active detail may expose only the bounded reviewer label. Historical rows that predate the migration map conservatively:

- synthetic source to `server_original`
- custom source to `unverified`

`POST /api/runs` does not gain a client-controlled trust field. The server derives origin status from the chosen fixture or uploaded bytes. Any client-supplied source label is ignored.

The source status flows through multipart parsing, execution input, run persistence, public serialization, workflow action policy, Workbench hydration and Operations metrics.

## Failure handling

- Digest calculation failure stops admission before provider construction with a safe error.
- Unknown digest is not an error and becomes `unverified`.
- Provider authentication, quota, rate-limit and provider failures keep the current safe error mapping.
- A provider failure never silently changes providers.
- A failed or cancelled request does not trigger a second paid call from the browser.
- Mocked failure tests cover provider rejection and malformed structured output without spending API credit.

## Verification and rollout

Implementation follows test-first development. Unit and contract coverage must prove:

- exact fixture bytes map to the correct committed fixture
- one changed byte becomes `unverified`
- renamed identical bytes remain `recognized_copy`
- screenshots and re-encoded copies remain accepted as `unverified`
- no client field can forge `server_original` or `recognized_copy`
- unverified evidence-consistent runs cannot prepare posting
- unverified runs retain permitted manual-review actions
- no provider is constructed when admission fails
- no paid call occurs on page load, model change, preview or file validation
- the selected provider and model reach the direct adapter unchanged
- confirmed provider attribution and cost appear only after dispatch

Before deployment run the complete unit, component, contract, accessibility, browser, type, lint, build, dependency, premium and public-surface checks with mocked provider responses.

After production redeployment verify that `/api/models` reports both configured providers available without exposing secret values. Then make only these two paid smoke calls:

1. One built-in synthetic run with OpenAI GPT-5.6 Luna.
2. One synthetic custom upload with Anthropic Claude Haiku 4.5 so the `unverified` route is exercised.

Do not retry either paid smoke call automatically. If a call fails then preserve the safe diagnostic, inspect platform logs and request approval before spending on another attempt.

## Rollback

Create an implementation checkpoint before code changes. The current production revision `96fbab6` remains the known rollback baseline. Keep the source-origin migration additive so an application rollback can continue reading old rows without deleting telemetry.

## Acceptance criteria

- Production visibly distinguishes live processing from deterministic sample handling before submission.
- A provider call can occur only after the primary run button is pressed.
- The cheapest recommended model is selected by default for each provider.
- Screenshots and modified copies continue through live extraction as `Source unverified`.
- Exact committed bytes receive the correct bounded origin label.
- Unverified evidence never enables posting preparation.
- Workbench and Operations expose live attribution, origin status and cost estimates without exposing secrets.
- All mocked checks pass before any paid request.
- No more than one final paid smoke call is made per provider without fresh approval.
- The deployment remains reversible to the pre-change commit.
