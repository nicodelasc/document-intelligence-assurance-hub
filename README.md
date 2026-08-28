# Document Intelligence Assurance Hub

Interpret synthetic business documents then inspect field evidence, a deterministic assurance decision and one constrained action proposal. The Workbench prepares internal dry-run actions. Operations exposes public-safe traces, action readiness, deterministic benchmark quality and an illustrative resource calculator.

- [Open the Workbench](https://document-intelligence-assurance-hub.vercel.app/workbench)
- [Open the Operations Console](https://document-intelligence-assurance-hub.vercel.app/operations)
- [Watch the two-minute walkthrough](artifacts/walkthrough.webm)

The stable production deployment currently runs in keyless demo mode with Neon telemetry and private Blob document storage. `AI_LIVE_ENABLED` remains false and model-provider keys are absent. Demo runs never call a model provider and provider or model execution is shown as `Not called (demo)`.

This is a public-safe portfolio application. Use synthetic fixtures unless you choose the custom-upload path and understand that the run is voluntarily public until expiry or deletion. Never upload personal data, confidential business data, credentials or regulated records.

## Modes

Demo mode is the default and works without model credentials. It returns deterministic synthetic results for each document scenario. The model dropdown remains useful for configuration review but its selection does not cause or imply a provider call.

Live mode is disabled unless `AI_LIVE_ENABLED=true` and the selected server-side key exists. When enabled the runtime can integrate directly with the OpenAI API or Anthropic API through one provider port. No live provider run is claimed in this repository. Live acceptance remains pending.

## Model catalogue

The server owns the four-model catalogue and dated pricing metadata. Requests fail closed when the chosen model does not belong to the selected provider.

| Provider  | Model ID           | Display name     | Catalogue role       |
| --------- | ------------------ | ---------------- | -------------------- |
| OpenAI    | `gpt-5.6-luna`     | GPT-5.6 Luna     | Recommended for cost |
| OpenAI    | `gpt-5.6-terra`    | GPT-5.6 Terra    | Higher accuracy      |
| Anthropic | `claude-haiku-4-5` | Claude Haiku 4.5 | Recommended for cost |
| Anthropic | `claude-sonnet-5`  | Claude Sonnet 5  | Higher accuracy      |

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
  Decision --> Repository[Repository, action dry run and telemetry]
  Repository -. optional .-> Neon[(Neon)]
  Workflow -. optional .-> Blob[(Private Blob)]
```

See [docs/architecture.md](docs/architecture.md) for adapter boundaries and trust assumptions.

## Responsible AI safeguards

- Model output must pass a structured schema before evaluation.
- Live evidence must map to a contiguous span on its claimed page before server-owned normalization can pass it.
- Text-native PDFs are parsed locally. PNG, JPEG and scanned PDF pages use bounded local OCR with bundled English language data. Document bytes are not sent to another grounding service.
- Clear requires every requested field to pass deterministic checks and any supplied reference comparison.
- Provider failures use stable public error codes. Hidden provider details are not returned.
- Live mode has per-browser limits, global limits and a parsed daily model budget.
- Connected mode enforces deployment-wide minute ceilings in Neon for submissions, documents, metrics, run lists and active traces. Rotating the anonymous cookie does not bypass each resource's global ceiling.
- Duplicate submissions use a durable idempotency claim when Neon is connected.
- Documents are private in Blob and are served only through active same-origin routes.
- Cancellation propagates through the response stream, workflow and provider request.
- Action policy runs on the server after evaluation. A proposal cannot approve or execute a business action.
- Stage action uses the browser-held run capability to persist one idempotent internal dry-run event. There is no ERP, ticketing, payment, inventory or access-control connector.

## Evaluation status

The public deterministic benchmark aggregates three provider-neutral observations with one observation per synthetic fixture. The warehouse receiving sheet resolves Clear with a ready inventory-receipt action. The invoice exception packet resolves Needs review with an accounts-payable review action. The visitor access request resolves Incomplete with a blocked security-review action. The deterministic false-clear count is zero.

A separate six-cell recorded-adapter contract matrix checks the three fixtures under both provider configurations against the shared result schema. Those checks do not call a provider and do not attribute results to a provider. Neither evidence set is a live provider accuracy measurement. See [docs/evaluation-report.md](docs/evaluation-report.md).

## Local setup

Requirements: Node.js 20 or later and npm 11.3.0.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

Keep `AI_LIVE_ENABLED=false` for the keyless path. Local keyless mode uses process-memory adapters when database and Blob variables are absent. Restarting the process clears those local runs. Action staging remains an internal dry run and never requires an external connector.

## Verification commands

```bash
npm run format:check
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

`npm run record:walkthrough -- --base-url http://127.0.0.1:3100 --output artifacts/walkthrough.webm` records the real browser flow with public-safe chapter captions. The included 2:03 artifact was captured from the stable keyless deployment at 1440×900. The 2026-08-28 local dependency audit reported zero vulnerabilities. Rerun it for every rollout.

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
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

PowerShell users can replace `$DATABASE_URL` with `$env:DATABASE_URL`. The migration is versioned and idempotent. Routine application requests do not create or alter schema.

## Environment variables

| Variable                        | Required             | Purpose                                                                                                                     |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AI_LIVE_ENABLED`               | Yes                  | Global model kill switch. Keep `false` until live acceptance passes.                                                        |
| `OPENAI_API_KEY`                | Live OpenAI only     | Server-side provider credential.                                                                                            |
| `ANTHROPIC_API_KEY`             | Live Anthropic only  | Server-side provider credential.                                                                                            |
| `GLOBAL_DAILY_MODEL_BUDGET_USD` | Yes                  | Positive finite daily budget with a US$5 default. Invalid values stop startup.                                              |
| `DATABASE_URL`                  | Production           | Server-side Neon connection string.                                                                                         |
| `BLOB_READ_WRITE_TOKEN`         | Production           | Server-side private Blob credential.                                                                                        |
| `CRON_SECRET`                   | Connected production | Random bearer secret of at least 32 characters with no whitespace. Weak or missing values stop request-serving startup.     |
| `PUBLIC_SITE_URL`               | Rollout              | Stable public origin used by rollout tooling.                                                                               |
| `ALLOW_IN_MEMORY_PERSISTENCE`   | Local exception only | Allows recorded synthetic production smoke tests without durable adapters. Custom uploads and live mode remain unavailable. |

Never commit environment files or paste secret values into logs, issues or recordings.

## Retention and deletion

Active access ends after 23 hours and 55 minutes. Delete now uses a one-time raw token returned only with the terminal stream. The repository tombstones details before it attempts physical Blob deletion. If Blob cleanup fails then access remains denied and the hourly purge retries the durable cleanup job.

The application does not provide user accounts or private per-user run visibility. Stage action is protected by the browser-held run capability but that capability is not enterprise authentication. See [docs/privacy-and-retention.md](docs/privacy-and-retention.md).

## API routes

| Method   | Route                        | Purpose                                                                                                                   |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/runs`                  | Validate quota then stream one assurance run. Requires `Idempotency-Key`, `X-Run-Source-Type` and `X-Run-Execution-Mode`. |
| `GET`    | `/api/models`                | Return the enabled server-owned model catalogue and defaults.                                                             |
| `GET`    | `/api/runs`                  | List bounded active public run summaries.                                                                                 |
| `GET`    | `/api/runs/:id`              | Read one public-safe active run.                                                                                          |
| `POST`   | `/api/runs/:id/stage-action` | Persist one capability-protected internal action dry run without an external connector.                                   |
| `DELETE` | `/api/runs/:id`              | Tombstone details with the one-time deletion token.                                                                       |
| `GET`    | `/api/runs/:id/document`     | Serve one active document through a no-store same-origin response.                                                        |
| `GET`    | `/api/metrics`               | Return public-safe operational, action-readiness and deterministic benchmark aggregates.                                  |
| `GET`    | `/api/cron/purge-expired`    | Tombstone expired details and retry physical cleanup.                                                                     |

## Deployment readiness

The repository contains an hourly Vercel Cron schedule at `0 * * * *`. A Vercel plan that cannot run hourly Cron is a rollout blocker. Routes use the Node.js runtime for streaming, crypto, Neon and Blob compatibility.

Follow [docs/deployment-checklist.md](docs/deployment-checklist.md). The public keyless deployment is active at the stable links above. It demonstrates deterministic document-to-action behavior only. Live-provider acceptance remains a separate credential-gated activity and is not claimed.

## Limitations and live-acceptance gate

This application lacks authentication, private tenant boundaries, malware scanning, data-loss prevention and a formally approved enterprise retention policy. Public custom uploads are voluntary and unsuitable for sensitive information. Its staging capability persists internal dry-run state only and cannot contact an external business system.

Keep live mode disabled until an authorized reviewer completes one OpenAI run, one Anthropic run, one deliberate live failure and one production retention simulation. Each must preserve safe errors, deterministic decisions, durable quotas and logical denial before cleanup.

The production acceptance must also exercise one text-native PDF and one PNG or scanned PDF on the target Linux runtime. A local Windows build proves the code path and bundled manifests but it does not prove the target native canvas binary until Vercel builds the deployment.
