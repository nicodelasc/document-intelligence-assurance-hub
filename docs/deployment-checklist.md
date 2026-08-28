# Deployment checklist

Use this checklist for each controlled rollout. The 2026-08-28 keyless production deployment uses the stable Workbench and Operations URLs in the repository README. Live-provider acceptance remains separately gated.

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

## Apply and verify the migration

Run through a trusted terminal or the Neon SQL editor. Never paste the connection string into a log or issue.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_assurance_hub.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0002_provider_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0003_public_resource_controls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0004_conservative_provider_budget.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0005_provider_dispatch_budget.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0006_bounded_provider_settlement.sql
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

- [ ] `0001_assurance_hub` appears exactly once.
- [ ] `0002_provider_lifecycle` appears exactly once.
- [ ] `0003_public_resource_controls` appears exactly once.
- [ ] `0004_conservative_provider_budget` appears exactly once.
- [ ] `0005_provider_dispatch_budget` appears exactly once.
- [ ] `0006_bounded_provider_settlement` appears exactly once.
- [ ] Reapplying the migration succeeds.
- [ ] `document_cleanup_jobs` and `run_submission_claims` exist.
- [ ] `reserve_daily_quota`, `settle_daily_quota`, `settle_reserved_daily_quota` and `reconcile_stale_daily_quota` exist.
- [ ] `model_budget_reservations.expires_at` exists and expired pending leases move their stored reservation into daily spend after 15 minutes.
- [ ] `public_rate_limit_windows` and `consume_public_resource_limit` exist.
- [ ] Parallel requests from rotated test cookies stop at the configured global minute ceiling.
- [ ] A normal application request produces no schema DDL.

## Configure the deployment

- [ ] Set `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` together.
- [ ] Confirm the Blob store is private.
- [ ] Set `CRON_SECRET` and verify Vercel sends the expected bearer authorization. Connected production request handling refuses to start when this value is missing or weak.
- [ ] Set `PUBLIC_SITE_URL` to the stable HTTPS origin.
- [ ] Keep every secret server-side and avoid all `NEXT_PUBLIC_` secret names.
- [ ] Confirm `/api/cron/purge-expired` is scheduled at `0 * * * *`.
- [ ] Confirm API routes run on the Node.js runtime.
- [ ] Confirm the Vercel Linux build includes the local Tesseract worker, `eng.traineddata.gz` and the matching Linux `@napi-rs/canvas` binary.

## Keyless rollout smoke

- [ ] Build without provider keys.
- [ ] Open Workbench and complete clean, mismatch and missing-field recorded runs.
- [ ] Select both provider options and verify the UI remains recorded.
- [ ] Compare two distinct runs.
- [ ] Open Operations and inspect benchmark coverage.
- [ ] Verify an expired document is denied before physical purge.
- [ ] Exercise Delete now and confirm the public detail disappears before Blob cleanup.
- [ ] Run `npm run verify:public -- --origin "$PUBLIC_SITE_URL"`.
- [ ] Record the two-minute walkthrough if the reviewer needs an artifact.

Do not treat an in-memory production exception as a durable rollout. `ALLOW_IN_MEMORY_PERSISTENCE=true` is limited to recorded synthetic smoke testing. Custom uploads remain unavailable and production live mode still requires Neon.

## Live acceptance gate

- [ ] Nicholas explicitly authorizes a controlled provider-key session.
- [ ] One OpenAI run passes.
- [ ] One Anthropic run passes.
- [ ] One deliberate provider failure returns only the safe mapped error.
- [ ] One production retention simulation proves logical denial before physical cleanup.
- [ ] Daily budget reservation and settlement are visible in durable state.
- [ ] One text-native PDF proves contiguous evidence grounding on the target runtime.
- [ ] One PNG or scanned PDF proves local OCR grounding on the target runtime.
- [ ] Provider credentials are removed or rotated after the session as required.

If any item fails then set `AI_LIVE_ENABLED=false` and keep the keyless deployment only.
