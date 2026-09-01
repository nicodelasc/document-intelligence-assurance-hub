# Document Intelligence Assurance Hub

Finance and warehouse teams manually review supplier invoices and goods receipts before payment or inventory posting. Typed fields, handwritten notes and reference mismatches can be missed. The Hub extracts evidence, compares it with trusted synthetic records, identifies exceptions and prepares a controlled human handoff before downstream posting. The Workbench supports the finance and warehouse checkpoints while Operations leads with the procurement review queue and keeps technical traceability in the selected-record inspector.

- [Open the Workbench](https://document-intelligence-assurance-hub.vercel.app/workbench)
- [Open the Operations Console](https://document-intelligence-assurance-hub.vercel.app/operations)

The public routes are portfolio review surfaces. Configuration alone is not acceptance evidence. Mocked release evidence is separate from connected production observation. Two controlled production requests were dispatched and both used OpenAI GPT-5.6 Luna with zero retries. Each failed closed during local evidence grounding before a result. Conservative settled spend is US$0.0028036 in total. Anthropic has not been called. The model-selection race and serverless OCR cold-start limit found by these observations are patched but no post-fix paid rerun has been made. Connected acceptance remains incomplete.

This is a public-safe portfolio application. Use synthetic fixtures unless you choose the custom-upload path and understand that the run is voluntarily public until expiry or deletion. Never upload personal data, confidential business data, credentials or regulated records.

## Processing routes

`GET /api/models` returns the server-owned catalogue, provider defaults and availability booleans. It never returns a credential. OpenAI and Anthropic keys remain server-side.

`POST /api/runs` derives execution mode from the validated model provider and current server-owned provider availability. The multipart execution mode and matching preflight header are request-consistency metadata only. They cannot force fallback, force live processing or switch providers.

For a built-in sample the selected model controls the route. When its provider is available the button says `Run live document review`. One deliberate reviewer click sends the sample through that selected model adapter. When the provider is unavailable the button says `Assess sample without AI processing` and uses the checked-in deterministic result. The completed interface states `Sample results - no AI processing`. A selected or enabled model is not proof that a provider request occurred.

Custom uploads have no recorded fallback. An unavailable selected provider disables the action and shows `Processing unavailable for this model`. The file, requested fields and consent remain local to the form until the reviewer can choose an available route.

Only a submission through `Run live document review` can create a model-budget reservation. Browsing samples, opening previews, comparing runs and preparing simulated workflow actions cannot reserve model spend. Persisted `providerDispatched=true` is the only execution fact used to report a provider call. Configured provider and model values remain separate from actual attribution.

## Source-origin boundary

The result shows one bounded server-owned label: `Original demo document`, `Exact copy of a demo document` or `Source unverified`. Exact SHA-256 matching proves byte equality with a committed synthetic sample only. It does not prove authorship, authenticity, fraud status or malware safety. Digests and the committed manifest stay server-side.

Screenshots, re-encodings, edits and unrelated supported files are processed as `Source unverified`. They are not rejected by origin classification. They require a person before any posting handoff and an unverified run can never expose `Prepare posting handoff`.

## Model catalogue

The server owns the four-model catalogue and dated pricing metadata. Requests fail closed when the chosen model does not belong to the selected provider.

| Provider  | Model ID           | Display name     | Catalogue role       | Input / 1M tokens | Output / 1M tokens |
| --------- | ------------------ | ---------------- | -------------------- | ----------------- | ------------------ |
| OpenAI    | `gpt-5.6-luna`     | GPT-5.6 Luna     | Recommended for cost | US$0.20           | US$1.20            |
| OpenAI    | `gpt-5.6-terra`    | GPT-5.6 Terra    | Higher accuracy      | US$2.00           | US$12.00           |
| Anthropic | `claude-haiku-4-5` | Claude Haiku 4.5 | Recommended for cost | US$1.00           | US$5.00            |
| Anthropic | `claude-sonnet-5`  | Claude Sonnet 5  | Higher accuracy      | US$2.00           | US$10.00           |

Pricing is dated 2026-09-01. GPT-5.6 requests above 272,000 input tokens apply the long-context tier to the full request at two times the listed input rate and 1.5 times the listed output rate. The default daily model budget is US$8.46. It is derived by rounding the highest supported two-call reservation of US$8.456 upward to cents. This is a conservative reservation ceiling and not expected spend.

## Architecture

```mermaid
flowchart LR
  Browser --> Route[Next.js route]
  Route --> Gate[Validation and quota]
  Gate --> Workflow
  Workflow --> Provider[One provider port]
  Provider --> Grounding[Local document grounding]
  Grounding --> Evaluators[Field evaluators]
  Evaluators --> Decision[Deterministic decision and action policy]
  Decision --> Repository[Repository, workflow events and telemetry]
  Repository -. optional .-> Neon[(Neon)]
  Workflow -. optional .-> Blob[(Private Blob)]
```

See [docs/architecture.md](docs/architecture.md) for adapter boundaries and trust assumptions.

## Responsible AI safeguards

- Model output must pass a structured schema before evaluation.
- Provider-routed evidence must map to a contiguous span on its claimed page before server-owned normalization can pass it.
- Typed fixture evidence is native PDF text. Handwritten reviewer and receiver comments are embedded as raster images so the selected model must interpret the visible handwriting rather than selectable comment text.
- Text-native PDFs are parsed locally. Live synthetic fixtures with handwritten evidence use explicit visual grounding: each validated PDF page is also rendered for bounded local OCR then native text and OCR text are merged for page-scoped evidence checks. PNG, JPEG and scanned PDF pages use the bounded local OCR path with bundled English language data. Document bytes are not sent to another grounding service.
- Unclear critical handwriting must return null and resolve as Not found. The model is instructed not to guess or reconstruct obscured characters from business context.
- Clear requires every requested field to pass deterministic checks and any supplied reference comparison.
- Provider failures use stable public error codes. Hidden provider details are not returned.
- Provider-routed processing has per-browser limits, global limits and a parsed daily model budget.
- Connected mode enforces deployment-wide minute ceilings in Neon for submissions, documents, metrics, run lists and active traces. Rotating the anonymous cookie does not bypass each resource's global ceiling.
- Duplicate submissions use a durable idempotency claim when Neon is connected.
- Documents are private in Blob and are served only through active same-origin routes.
- Cancellation propagates through the response stream, workflow and provider request.
- Action policy runs on the server after evaluation. A proposal cannot approve or execute a business action.
- Workflow actions use the browser-held run capability plus server-owned status, outcome and recipient-role policy. Recipient-required actions accept one synthetic business-role label and never an address.
- `Prepare email copy` returns a bounded preview labelled `Prepared only - not sent`. Its subject and body are not persisted. The interface can copy the text but cannot send it.
- `/api/runs/:id/stage-action` remains an idempotent compatibility mapping to the internal `approve_and_stage` identifier. New posting-handoff events use status `prepared`. Real email and every ERP, ticketing, payment, inventory or access-control connector remain out of scope.

The approved reviewer-written files live under `assets/sample-overrides/` with matching PNG previews. The sample generator copies these approved PDF sources instead of overwriting them with generated placeholder handwriting. Recorded synthetic runs keep their deterministic result and do not invoke OCR or a provider. Custom uploads keep the bounded text-or-scan path. Visual grounding stays local, cancellable, page-limited and fail-closed without introducing a second provider call.

## Outcome-specific actions

The Workbench exposes only the controls needed to prepare the next responsible review step:

| Result                                  | Controls                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Ready for posting review                | `Prepare posting handoff`                                                 |
| Exception review required               | `Assign exception review` and `Draft clarification request`               |
| Awaiting readable evidence              | `Request clearer evidence`, `Assign manual review` and `Replace document` |
| Failed                                  | `Retry processing`                                                        |
| Irrelevant or uncertain custom document | `Replace with a supported procurement document`                           |

`Draft clarification request` uses the prepared-email preview. It remains `Prepared only - not sent` and accepts only a server-approved synthetic role.

## Evaluation status

The Reference quality suite contains 10 provider-neutral observations: 5 supplier invoices and 5 warehouse goods receipts. Its classifications are 2 Correct, 4 Needs attention and 4 Incorrect. Expected outcomes are 2 Clear, 6 Needs review and 2 Incomplete. It detects 2 of 2 unreadable critical fixtures and the false-clear count is zero.

A separate 10 by 2 recorded-adapter matrix contains 20 schema and configuration cases. Each fixture is checked under the OpenAI configuration and the Anthropic configuration without a provider call. These cases are not provider observations and are not a model-accuracy measurement. See [docs/evaluation-report.md](docs/evaluation-report.md).

## Operations and Costs metric populations

Operations combines seven server-side data sources behind a 15-second cache. The summary cards use a repository-wide anonymous run aggregate. Source-origin counts are repository-wide original demo runs, exact-copy uploads and unverified uploads. Lifecycle uses a repository-wide active-detail aggregate plus the repository-wide cleanup backlog. `Procurement review queue` appears before `Triage status`, processing performance and the `Reference quality suite`. The queue leads with document reference, document type, review decision, exception, prepared next step and received time. Run ID, model, token, latency, expiry and safe diagnostics remain in `Review record and technical trace`. The queue plus workflow and performance panels use the newest 100 public run summaries with active detail where available.

Costs keeps provider execution evidence separate from budget accounting. Confirmed provider usage, model and document-family breakdowns plus completed-run cost estimates use only confirmed dispatched completed runs with trustworthy nonzero token usage. When that population is empty the dashboard shows `No confirmed model runs` and US$0.00. A failed dispatched request can contribute conservative settled spend but it is excluded from completed-run estimates and their average.

The quota ledger supplies settled spend for today and month to date. Daily budget use is settled spend plus active reservations and remaining budget is clamped at zero. These quota values must not be combined with completed-run estimates as if they were the same population.

The Reference quality suite is a separate fixed set of exactly 10 provider-neutral observations. The resource calculator is an illustrative scenario rather than measured savings. It converts only the confirmed average model cost into its SGD assumption at `US$1 = S$1.35` and trusts the server-supplied pricing date.

## Local setup

Requirements: Node.js 20 or later and npm 11.3.0.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

Keep `AI_LIVE_ENABLED=false` when provider credentials are not intentionally under test. Local keyless operation uses process-memory adapters when database and Blob variables are absent. Built-in samples then use deterministic results while custom processing is unavailable. Restarting the process clears local runs and workflow events. No external connector exists for simulated workflow preparation.

## Verification commands

```bash
npm run format:check
npm run design:lint
npm run lint
npm run typecheck
npm run test:unit
npm run test:component
npm run test:contract
npm run test:a11y
npm run test:e2e
npm run verify:premium
npm run build:production
npm run verify:public
npm run audit:dependencies
```

The earlier three-fixture walkthrough and its video link are retired because they do not represent the current ten-reference library. Do not submit or cite that recording. The [current keyless walkthrough](artifacts/walkthrough.webm) shows `Review incoming procurement documents`, `Assess sample without AI processing`, `Review result`, `Prepared next step`, `Procurement review operations` and the queue-first Operations story plus explicit `No AI processing` attribution. It made no provider call. Rerun the dependency audit for every rollout.

## Connected persistence

Production requires `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` together. Create a Neon database then apply every migration in numeric order before starting the application. Create a private Vercel Blob store and keep its token server-side. Do not expose either value through a `NEXT_PUBLIC_` variable.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_assurance_hub.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0002_provider_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0003_public_resource_controls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0004_conservative_provider_budget.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0005_provider_dispatch_budget.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0006_bounded_provider_settlement.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0007_provider_dispatch_attribution.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0008_document_workflow.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0009_completed_run_aggregates.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0010_source_origin_status.sql
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

PowerShell users can replace `$DATABASE_URL` with `$env:DATABASE_URL`. The migration is versioned and idempotent. Routine application requests do not create or alter schema.

## Environment variables

| Variable                        | Required             | Purpose                                                                                                                     |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AI_LIVE_ENABLED`               | Yes                  | Global model kill switch. Keep `false` until live acceptance passes.                                                        |
| `OPENAI_API_KEY`                | Live OpenAI only     | Server-side provider credential.                                                                                            |
| `ANTHROPIC_API_KEY`             | Live Anthropic only  | Server-side provider credential.                                                                                            |
| `GLOBAL_DAILY_MODEL_BUDGET_USD` | Yes                  | Positive finite daily budget with a derived US$8.46 default. Invalid values stop startup.                                   |
| `DATABASE_URL`                  | Production           | Server-side Neon connection string.                                                                                         |
| `BLOB_READ_WRITE_TOKEN`         | Production           | Server-side private Blob credential.                                                                                        |
| `CRON_SECRET`                   | Connected production | Random bearer secret of at least 32 characters with no whitespace. Weak or missing values stop request-serving startup.     |
| `PUBLIC_SITE_URL`               | Rollout              | Stable public origin used by rollout tooling.                                                                               |
| `ALLOW_IN_MEMORY_PERSISTENCE`   | Local exception only | Allows recorded synthetic production smoke tests without durable adapters. Custom uploads and live mode remain unavailable. |

Never commit environment files or paste secret values into logs, issues or recordings.

## Retention and deletion

Active access ends after 23 hours and 55 minutes. Delete now uses a one-time raw token returned only with the terminal stream. The repository tombstones traces, results, workflow events and the document locator before it attempts physical Blob deletion. If Blob cleanup fails then access remains denied and the hourly purge retries the durable cleanup job.

The application does not provide user accounts or private per-user run visibility. Every workflow mutation is protected by the browser-held run capability but that capability is not enterprise authentication. See [docs/privacy-and-retention.md](docs/privacy-and-retention.md).

## API routes

| Method   | Route                            | Purpose                                                                                                                                                         |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/runs`                      | Derive server-owned admission, validate quota then stream one exception assessment. Requires `Idempotency-Key`, `X-Run-Source-Type` and `X-Run-Execution-Mode`. |
| `GET`    | `/api/models`                    | Return the server-owned catalogue, defaults and provider-availability booleans without credentials.                                                             |
| `GET`    | `/api/runs`                      | List bounded active public run summaries.                                                                                                                       |
| `GET`    | `/api/runs/:id`                  | Read one public-safe active run.                                                                                                                                |
| `POST`   | `/api/runs/:id/workflow-actions` | Persist one capability-protected simulated workflow event under outcome and recipient-role policy.                                                              |
| `POST`   | `/api/runs/:id/stage-action`     | Compatibility mapping that persists the same idempotent `approve_and_stage` event.                                                                              |
| `DELETE` | `/api/runs/:id`                  | Tombstone details with the one-time deletion token.                                                                                                             |
| `GET`    | `/api/runs/:id/document`         | Serve one active document through a no-store same-origin response.                                                                                              |
| `GET`    | `/api/metrics`                   | Return public-safe operational, action-readiness and deterministic benchmark aggregates.                                                                        |
| `GET`    | `/api/cron/purge-expired`        | Tombstone expired details and retry physical cleanup.                                                                                                           |

## Deployment readiness

The repository contains an hourly Vercel Cron schedule at `0 * * * *`. A Vercel plan that cannot run hourly Cron is a rollout blocker. Routes use the Node.js runtime for streaming, crypto, Neon and Blob compatibility.

Follow [docs/deployment-checklist.md](docs/deployment-checklist.md). The stable links are review targets rather than acceptance evidence for this revision. Configuration, catalogue visibility and an enabled provider boolean do not accept a processing route.

## Limitations and live-acceptance gate

This application lacks authentication, private tenant boundaries, malware scanning, data-loss prevention and a formally approved enterprise retention policy. Public custom uploads are voluntary and unsuitable for sensitive information. Its workflow capability persists simulated internal state only. Prepared email copy is response-only and no route can send email or contact an external business system.

All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed.

Connected acceptance remains incomplete:

| Route                           | Status               | Connected evidence                                                                                                        |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Built-in sample through OpenAI  | Failed closed        | OpenAI dispatch was confirmed then PDF evidence grounding failed safely. Conservative settlement was US$0.001723.         |
| Custom upload through Anthropic | Pending - not called | A pre-fix selection race sent the custom PNG to OpenAI instead. That request failed safely during OCR evidence grounding. |

These are connected production observations rather than mocked evidence. The second OpenAI request added a conservative US$0.0010806 settlement. There is no automatic retry. Another paid call requires fresh approval. Prepared workflow events remain simulated and `Prepared only - not sent` remains true after connected model processing.

The production acceptance must also exercise one text-native PDF and one PNG or scanned PDF on the target Linux runtime. A local Windows build proves the code path and bundled manifests but it does not prove the target native canvas binary until Vercel builds the deployment.
