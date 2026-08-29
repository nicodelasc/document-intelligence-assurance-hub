# Deployment checklist

Use this checklist for each controlled rollout. The 2026-08-28 keyless production deployment uses the stable Workbench and Operations URLs in the repository README. It demonstrates deterministic sample behavior only. Provider acceptance remains separately gated and is not established by this checklist.

The completed keyless rollout record is in [evaluation-report.md](evaluation-report.md). Keep the checklist below reusable for later releases.

## Before creating a deployment

- [ ] Review the Task 5 verification report and confirm the worktree commit.
- [ ] Select an npm-based build using the committed `package-lock.json` and `packageManager` metadata.
- [ ] Provision Neon and private Vercel Blob in the target project.
- [ ] Confirm the selected Vercel plan supports hourly Cron. Plan incompatibility is a rollout blocker.
- [ ] Keep `AI_LIVE_ENABLED=false`.
- [ ] Generate a cryptographically random `CRON_SECRET` with at least 32 non-whitespace characters in the deployment secret store.
- [ ] Set `GLOBAL_DAILY_MODEL_BUDGET_USD` to a positive finite value.
- [ ] Leave provider keys absent until explicit live-test authorization.
- [ ] Confirm the server-owned catalogue contains GPT-5.6 Luna, GPT-5.6 Terra, Claude Haiku 4.5 and Claude Sonnet 5 with the expected provider mapping.
- [ ] Confirm unknown models and provider-model mismatches fail closed.

## Apply and verify migrations

Run through a trusted terminal or the Neon SQL editor. Never paste the connection string into a log or issue.

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
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

- [ ] `0001_assurance_hub` appears exactly once.
- [ ] `0002_provider_lifecycle` appears exactly once.
- [ ] `0003_public_resource_controls` appears exactly once.
- [ ] `0004_conservative_provider_budget` appears exactly once.
- [ ] `0005_provider_dispatch_budget` appears exactly once.
- [ ] `0006_bounded_provider_settlement` appears exactly once.
- [ ] `0007_provider_dispatch_attribution` appears exactly once.
- [ ] `0008_document_workflow` appears exactly once.
- [ ] `0009_completed_run_aggregates` appears exactly once.
- [ ] Reapply all migrations 0001 through 0009 with the same commands. Every command succeeds and every `schema_migrations` version still appears exactly once to prove idempotence.
- [ ] `document_cleanup_jobs` and `run_submission_claims` exist.
- [ ] `reserve_daily_quota`, `settle_daily_quota`, `settle_reserved_daily_quota` and `reconcile_stale_daily_quota` exist.
- [ ] `model_budget_reservations.expires_at` exists and expired pending leases move their stored reservation into daily spend after 15 minutes.
- [ ] `runs.provider_dispatched` defaults to false and changes only after confirmed provider dispatch.
- [ ] `public_rate_limit_windows` and `consume_public_resource_limit` exist.
- [ ] `runs.document_family` and `runs.fixture_id` exist and remain nullable for earlier rows.
- [ ] `workflow_events` exists with its run foreign key and metadata-only action fields.
- [ ] `workflow_events_idempotency_idx` exists as the unique idempotency index.
- [ ] `workflow_events_run_created_idx` exists as the chronological run index.
- [ ] `runs.completed_at` exists.
- [ ] The safe completed-row backfill leaves zero rows where `was_completed = true` and `runs.completed_at IS NULL`.
- [ ] `runs_confirmed_model_cost_idx` exists with the confirmed-dispatch completed-row predicate.
- [ ] Parallel requests from rotated test cookies stop at the configured global minute ceiling.
- [ ] A normal application request produces no schema DDL.

Use these read-only checks after both applications:

```sql
SELECT version, COUNT(*) AS applied_count
FROM schema_migrations
WHERE version BETWEEN '0001_assurance_hub' AND '0009_completed_run_aggregates'
GROUP BY version
ORDER BY version;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'runs'
  AND column_name IN ('document_family', 'fixture_id', 'completed_at')
ORDER BY column_name;

SELECT to_regclass('public.workflow_events') AS workflow_events,
       to_regclass('public.workflow_events_idempotency_idx') AS workflow_events_idempotency_idx,
       to_regclass('public.workflow_events_run_created_idx') AS workflow_events_run_created_idx,
       to_regclass('public.runs_confirmed_model_cost_idx') AS runs_confirmed_model_cost_idx;

SELECT COUNT(*) AS completed_rows_missing_completed_at
FROM runs
WHERE was_completed = true
  AND completed_at IS NULL;
```

## Configure the deployment

- [ ] Set `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` together.
- [ ] Confirm the Blob store is private.
- [ ] Set `CRON_SECRET` and verify Vercel sends the expected bearer authorization. Connected production request handling refuses to start when this value is missing or weak.
- [ ] Set `PUBLIC_SITE_URL` to the stable HTTPS origin.
- [ ] Keep every secret server-side and avoid all `NEXT_PUBLIC_` secret names.
- [ ] Confirm `/api/cron/purge-expired` is scheduled at `0 * * * *`.
- [ ] Confirm API routes run on the Node.js runtime.
- [ ] Confirm the Vercel Linux build includes the local Tesseract worker, `eng.traineddata.gz` and the matching Linux `@napi-rs/canvas` binary.

## Keyless demo rollout smoke

- [ ] Build without provider keys and keep `AI_LIVE_ENABLED=false`.
- [ ] Open Workbench. Confirm `Supplier invoices` and `Warehouse goods receipts` each expose five fixtures without starting a model request.
- [ ] Under Supplier invoices process `Clean match` as Correct, `Buyer hold` as Needs attention and `Total mismatch` as Incorrect.
- [ ] Under Warehouse goods receipts process `Clean receipt` as Correct, `Quantity correction` as Needs attention and `Quantity mismatch` as Incorrect.
- [ ] Confirm the native `Processing model` selector lists all four catalogue models and browsing or changing the selection creates no run.
- [ ] Press `Process document` for each selected fixture. Confirm fallback runs say `Sample results - no AI processing` and run attribution says `No AI processing`.
- [ ] Confirm the visible trace contains Understand document, Verify evidence and Resolve and prepare action.
- [ ] Prepare one simulated email-copy workflow. Confirm the blank Recipient role keeps `Prepare copy` disabled then select an allowed synthetic role.
- [ ] Confirm the preview says `Prepared only - not sent`, exposes no delivery control and adds one prepared event to the Workflow activity timeline.
- [ ] Exercise retry and confirm a single replacement-file selection does not auto-run. Processing starts only after consent and a later `Process document` action.
- [ ] Download a discrepancy summary and confirm its UTF-8 text opens cleanly.
- [ ] Compare two distinct runs with Run A and Run B.
- [ ] Confirm no external connector exists for email, ERP, ticketing, payment, inventory or access control. Every workflow event is simulated preparation only.
- [ ] Open the `Operations workspace` and confirm workflow status, workflow activity, processing performance and the newest-100 explorer scope.
- [ ] Confirm Reference quality reports exactly 10 provider-neutral observations: five Supplier invoices and five Warehouse goods receipts.
- [ ] Confirm the `Costs workspace` shows settled and completed estimates as `US$0.00` in keyless mode and confirmed usage says `No confirmed model runs`.
- [ ] Confirm the Illustrative resource scenario uses SGD inputs, states `US$1 = S$1.35` and labels every result illustrative.
- [ ] At desktop width confirm the two-thirds Operations and one-third Costs layout. At mobile width confirm Operations appears before Costs.
- [ ] Verify an expired document is denied before physical purge.
- [ ] Exercise Delete now and confirm the public detail disappears before Blob cleanup.
- [ ] Run `npm run verify:public -- --origin "$PUBLIC_SITE_URL"`.
- [ ] Record the two-minute walkthrough if the reviewer needs an artifact.

Do not treat an in-memory production exception as a durable rollout. `ALLOW_IN_MEMORY_PERSISTENCE=true` is limited to deterministic synthetic smoke testing. Custom uploads remain unavailable and production live mode still requires Neon.

## Provider acceptance gate

- [ ] Nicholas explicitly authorizes a controlled provider-key session.
- [ ] One authorized OpenAI catalogue run passes.
- [ ] One authorized Anthropic catalogue run passes.
- [ ] One deliberate provider failure returns only the safe mapped error.
- [ ] One production retention simulation proves logical denial before physical cleanup.
- [ ] Daily budget reservation and settlement are visible in durable state.
- [ ] One text-native PDF proves contiguous evidence grounding on the target runtime.
- [ ] One PNG or scanned PDF proves local OCR grounding on the target runtime.
- [ ] Provider credentials are removed or rotated after the session as required.
- [ ] In connected staging verify real lifecycle buckets, cleanup backlog and the newest-100 explorer scope.
- [ ] In connected staging verify expiry or Delete now denies detail before physical cleanup.

If any item fails then set `AI_LIVE_ENABLED=false` and keep the keyless deployment only.

Passing the keyless checklist does not establish provider acceptance. Prepared workflow events remain internal simulation even after authorized provider verification. They cannot deliver email or execute against an external business system.
