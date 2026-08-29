# Operations and Costs Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the dashboard into a truthful Operations workspace and a separate Costs workspace while exposing real performance, retention and confirmed-model cost data.

**Architecture:** Repository aggregates provide completed confirmed-model costs while the quota repository provides today's settled and reserved budget ledger. The metrics handler combines those sources with the ten-fixture reference suite and real active-detail expiry buckets. The client renders a two-thirds Operations column and a one-third Costs column without deriving financial truth from recorded fallback rows.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, Neon Postgres, Vitest 4.1.11 and Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-29-document-operations-workflow-redesign.md`

**Prerequisites:** Complete `docs/superpowers/plans/2026-08-29-document-library-ai-processing.md` through Task 3 so migration 0008 owns `document_family`, `fixture_id` and `workflow_events`. Complete `docs/superpowers/plans/2026-08-29-simulated-workflow-actions.md` through Task 2 so `PublicRunRecord.details.workflowEvents` and its repository hydration path exist before operational activity is aggregated.

## Global Constraints

- Count a provider or model only when `providerDispatched` is true.
- Calculate average API cost from completed dispatched runs with trustworthy usage only.
- Keep failed dispatched reservations visible in the budget ledger without treating them as completed-run cost observations.
- Recorded fallback rows contribute zero provider tokens and never dilute completed-model averages.
- Use UTC boundaries for today and month-to-date repository aggregates.
- Display estimated API cost in USD and keep the resource calculator explicitly illustrative in SGD.
- Use only real less-than-24-hour expiry buckets.
- Do not expose bucket identifiers, reservation identifiers, API keys or credentials.
- Follow TDD for every behavior change and commit after each independently testable task.

---

### Task 1: Add truthful confirmed-model cost and expiry aggregates

**Files:**

- Create: `migrations/0009_completed_run_aggregates.sql`
- Modify: `src/server/repositories/run-repository.ts`
- Create: `tests/contract/persistence/completed-run-aggregates-migration.test.ts`
- Modify: `tests/contract/routes/public-serialization.test.ts`
- Modify: `tests/unit/server/run-repository.test.ts`

**Interfaces:**

- Produces: `ConfirmedModelCostAggregate` and `RunRepository.aggregateConfirmedModelCosts`.
- Produces: `ActiveDetailLifecycleAggregate` and `RunRepository.aggregateActiveDetailLifecycle`.
- Consumes: Persisted `provider_dispatched`, status, usage, cost, model, family, completion time and expiry metadata.

- [ ] **Step 1: Write failing in-memory aggregate tests**

Create a fixed ledger containing:

```ts
const now = new Date("2026-08-29T12:00:00.000Z");
const rows = [
  completedDispatchedRun({
    id: "openai_invoice",
    model: "gpt-5.6-luna",
    documentFamily: "supplier_invoice",
    estimatedCostUsd: 0.08,
    usage: { inputTokens: 120, outputTokens: 20 },
    completedAt: "2026-08-29T08:00:00.000Z",
    expiresAt: "2026-08-29T12:30:00.000Z",
  }),
  completedDispatchedRun({
    id: "anthropic_warehouse",
    model: "claude-haiku-4-5",
    documentFamily: "warehouse_goods_receipt",
    estimatedCostUsd: 0.12,
    usage: { inputTokens: 180, outputTokens: 40 },
    completedAt: "2026-08-10T08:00:00.000Z",
    expiresAt: "2026-08-29T16:00:00.000Z",
  }),
  completedRecordedRun({
    id: "recorded_zero",
    estimatedCostUsd: 0,
    usage: { inputTokens: 999, outputTokens: 999 },
    expiresAt: "2026-08-29T22:00:00.000Z",
  }),
  failedDispatchedRun({ id: "failed_dispatch", estimatedCostUsd: 0.5 }),
];
```

Assert:

```ts
expect(await repository.aggregateConfirmedModelCosts(now)).toEqual({
  completedRunCount: 2,
  totalInputTokens: 300,
  totalOutputTokens: 60,
  providerCounts: { openai: 1, anthropic: 1 },
  totalEstimatedCostUsd: 0.2,
  averageEstimatedCostUsd: 0.1,
  todayEstimatedCostUsd: 0.08,
  monthToDateEstimatedCostUsd: 0.2,
  byModel: [
    {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      runCount: 1,
      totalEstimatedCostUsd: 0.12,
      averageEstimatedCostUsd: 0.12,
    },
    {
      provider: "openai",
      model: "gpt-5.6-luna",
      runCount: 1,
      totalEstimatedCostUsd: 0.08,
      averageEstimatedCostUsd: 0.08,
    },
  ],
  byFamily: [
    {
      documentFamily: "supplier_invoice",
      runCount: 1,
      totalEstimatedCostUsd: 0.08,
      averageEstimatedCostUsd: 0.08,
    },
    {
      documentFamily: "warehouse_goods_receipt",
      runCount: 1,
      totalEstimatedCostUsd: 0.12,
      averageEstimatedCostUsd: 0.12,
    },
  ],
});

expect(await repository.aggregateActiveDetailLifecycle(now)).toEqual({
  activeDocuments: 3,
  activePublicUploads: 0,
  expiryBuckets: {
    lessThanOneHour: 1,
    oneToSixHours: 1,
    sixToTwentyFourHours: 1,
  },
});
```

Set the two completed dispatched rows to a combined 300 input tokens plus 60 output tokens. Assert the recorded row's deliberately nonzero 999-token values affect neither confirmed usage nor cost. Assert the failed dispatched row does not affect completed-run usage or cost. Delete detailed data for one completed dispatched row then assert its safe usage and cost summary still contributes. Assert expired, deleted and detail-deleted rows do not affect expiry buckets.

- [ ] **Step 2: Run the repository tests and confirm failure**

```powershell
npx vitest run tests/unit/server/run-repository.test.ts
```

Expected: FAIL because the aggregate methods do not exist.

- [ ] **Step 3: Add exact aggregate contracts**

Add:

```ts
export type ConfirmedModelCostAggregate = {
  completedRunCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  providerCounts: Record<Provider, number>;
  totalEstimatedCostUsd: number;
  averageEstimatedCostUsd: number;
  todayEstimatedCostUsd: number;
  monthToDateEstimatedCostUsd: number;
  byModel: Array<{
    provider: Provider;
    model: string;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
  byFamily: Array<{
    documentFamily: DocumentFamily;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
};

export type ExpiryBucketCounts = {
  lessThanOneHour: number;
  oneToSixHours: number;
  sixToTwentyFourHours: number;
};

export type ActiveDetailLifecycleAggregate = {
  activeDocuments: number;
  activePublicUploads: number;
  expiryBuckets: ExpiryBucketCounts;
};
```

Add these methods to `RunRepository`:

```ts
aggregateConfirmedModelCosts(now: Date): Promise<ConfirmedModelCostAggregate>;
aggregateActiveDetailLifecycle(now: Date): Promise<ActiveDetailLifecycleAggregate>;
```

- [ ] **Step 4: Add migration 0009 and preserve completion time**

Write an idempotent migration:

```sql
BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE runs
SET completed_at = COALESCE(
  (
    SELECT (run_results.result_json ->> 'completedAt')::timestamptz
    FROM run_results
    WHERE run_results.run_id = runs.id
  ),
  created_at
)
WHERE was_completed = true
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS runs_confirmed_model_cost_idx
  ON runs (completed_at, provider, model)
  WHERE was_completed = true AND provider_dispatched = true;

INSERT INTO schema_migrations (version)
  VALUES ('0009_completed_run_aggregates')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

The migration test asserts the column, backfill, partial index and schema version. Extend `StoredRunRecord` with `completedAt: string | null`. Initial records set null. `saveResults` copies `result.completedAt` to the safe run summary in both repositories. Public serialization may expose the bounded ISO completion time but must not infer completion when it is null. Tombstoning never clears `completedAt`, provider, model, usage, estimated cost, family or fixture ID.

- [ ] **Step 5: Implement the in-memory aggregates**

Use a single eligibility predicate:

```ts
function isConfirmedCompletedModelRun(run: InternalRun): boolean {
  return (
    run.completionAggregated &&
    run.record.providerDispatched &&
    run.record.completedAt !== null &&
    run.record.usage.inputTokens + run.record.usage.outputTokens > 0
  );
}
```

Use `run.record.completedAt` for day and month boundaries. Do not require active detail or current status because `was_completed` summaries survive later expiry and deletion. Group model rows by `${provider}\u0000${model}` and family rows only when `documentFamily` is non-null. Sort model rows by provider then model. Sort family rows by document-family key.

For lifecycle counts include only records where details still exist, status is neither expired nor deleted and `expiresAt > now`. Count `activePublicUploads` where `sourceType === "custom"`. Use `remainingMs <= 1 hour`, `remainingMs <= 6 hours` and `remainingMs <= 24 hours` as mutually exclusive boundaries.

- [ ] **Step 6: Implement Neon aggregates with bounded SQL**

Use one summary query:

```sql
SELECT
  COUNT(*) AS completed_run_count,
  COALESCE(SUM((usage ->> 'inputTokens')::bigint), 0) AS input_tokens,
  COALESCE(SUM((usage ->> 'outputTokens')::bigint), 0) AS output_tokens,
  COUNT(*) FILTER (WHERE provider = 'openai') AS openai_runs,
  COUNT(*) FILTER (WHERE provider = 'anthropic') AS anthropic_runs,
  COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
  COALESCE(SUM(estimated_cost_usd) FILTER (
    WHERE completed_at >= date_trunc('day', $1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  ), 0) AS today_estimated_cost_usd,
  COALESCE(SUM(estimated_cost_usd) FILTER (
    WHERE completed_at >= date_trunc('month', $1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  ), 0) AS month_to_date_estimated_cost_usd
FROM runs
WHERE provider_dispatched = true
  AND was_completed = true
  AND ((usage ->> 'inputTokens')::bigint + (usage ->> 'outputTokens')::bigint) > 0
```

Use two bounded grouped queries with the same eligibility predicate. The model query groups by `provider, model`. The family query filters `document_family IS NOT NULL` then groups by `document_family`. Both return run count, total cost and average cost across all retained anonymous summaries. Sort hydrated rows with the same helper as the in-memory adapter.

Add one lifecycle query:

```sql
SELECT
  COUNT(*) AS active_documents,
  COUNT(*) FILTER (WHERE source_type = 'custom') AS active_public_uploads,
  COUNT(*) FILTER (WHERE expires_at <= $1::timestamptz + interval '1 hour') AS less_than_one_hour,
  COUNT(*) FILTER (WHERE expires_at > $1::timestamptz + interval '1 hour' AND expires_at <= $1::timestamptz + interval '6 hours') AS one_to_six_hours,
  COUNT(*) FILTER (WHERE expires_at > $1::timestamptz + interval '6 hours' AND expires_at <= $1::timestamptz + interval '24 hours') AS six_to_twenty_four_hours
FROM runs
WHERE details_deleted = false
  AND status NOT IN ('expired', 'deleted')
  AND expires_at > $1::timestamptz
  AND expires_at <= $1::timestamptz + interval '24 hours'
```

- [ ] **Step 7: Run repository and migration tests**

```powershell
npx vitest run tests/contract/persistence/document-workflow-migration.test.ts tests/contract/persistence/completed-run-aggregates-migration.test.ts tests/contract/routes/public-serialization.test.ts tests/unit/server/run-repository.test.ts
```

Expected: PASS with migration 0008 validated before 0009 plus deletion-safe cost summaries, UTC date boundaries and truthful expiry buckets.

- [ ] **Step 8: Commit repository aggregates**

```powershell
git add migrations/0009_completed_run_aggregates.sql src/server/repositories/run-repository.ts tests/contract/persistence/completed-run-aggregates-migration.test.ts tests/contract/routes/public-serialization.test.ts tests/unit/server/run-repository.test.ts
git commit -m "feat: add confirmed model cost aggregates"
```

---

### Task 2: Expose a safe daily budget snapshot

**Files:**

- Modify: `src/server/security/rate-limit.ts`
- Modify: `tests/unit/server/rate-limit.test.ts`

**Interfaces:**

- Extends: `QuotaSnapshot` with safe total budget and pending count.
- Preserves: Bucket-specific counts inside the repository for enforcement but excludes them from the metrics response.

- [ ] **Step 1: Write failing snapshot tests**

Reserve two live runs against a US$5 repository. Settle the first at US$0.40 and leave the second reserved at US$1.00. Assert:

```ts
expect(await quotas.snapshot(now)).toMatchObject({
  dailyBudgetUsd: 5,
  globalSpendUsd: 0.4,
  monthToDateSpendUsd: 0.9,
  reservedSpendUsd: 1,
  pendingReservationCount: 1,
});
```

Seed US$0.50 settled on an earlier UTC day in the same month so month to date is US$0.90. Assert a released reservation is not pending. Add a Neon adapter test that hydrates the same five safe fields. Assert a prior-month row does not contribute.

- [ ] **Step 2: Run rate-limit tests and confirm failure**

```powershell
npx vitest run tests/unit/server/rate-limit.test.ts
```

Expected: FAIL because `dailyBudgetUsd`, `monthToDateSpendUsd` and `pendingReservationCount` are absent.

- [ ] **Step 3: Extend the quota snapshot**

Add:

```ts
export type QuotaSnapshot = {
  dailyBudgetUsd: number;
  globalSpendUsd: number;
  monthToDateSpendUsd: number;
  reservedSpendUsd: number;
  pendingReservationCount: number;
  globalCustomUploads: number;
  globalRecordedRuns: number;
  customUploadsByBucket: Record<string, number>;
  liveRunsByBucket: Record<string, number>;
  recordedRunsByBucket: Record<string, number>;
};
```

The in-memory adapter returns its configured `dailyBudgetUsd`, counts pending reservations for the requested UTC day after stale-reservation reclamation and sums `globalSpendUsd` for every stored UTC day whose `YYYY-MM` prefix matches the requested month.

Update the Neon snapshot query to return today's `global_spend_usd`, month-to-date `SUM(daily_usage.global_spend_usd)` and `COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > $1)` plus the configured server-side budget. Do not query or return reservation IDs.

- [ ] **Step 4: Run rate-limit tests**

```powershell
npx vitest run tests/unit/server/rate-limit.test.ts
```

Expected: PASS for safe totals and no bucket-regression changes.

- [ ] **Step 5: Commit the budget snapshot**

```powershell
git add src/server/security/rate-limit.ts tests/unit/server/rate-limit.test.ts
git commit -m "feat: expose safe model budget totals"
```

---

### Task 3: Rebuild the metrics response around Operations and Costs

**Files:**

- Modify: `src/server/http/metrics-handler.ts`
- Modify: `tests/unit/server/metrics-handler.test.ts`
- Modify: `tests/contract/routes/metrics-cron.test.ts`

**Interfaces:**

- Produces: `MetricsPayload.operations`, `MetricsPayload.costs`, `MetricsPayload.referenceQuality`, `MetricsPayload.retention` and the existing `resourceScenario`.
- Consumes: Anonymous usage aggregate, confirmed cost aggregate, expiry buckets, quota snapshot, public runs and cleanup backlog.
- Preserves: `summary`, `performance` and `runExplorer` during one release for compatibility.

- [ ] **Step 1: Write failing metrics contract tests**

Inject a repository containing recorded runs, completed dispatched runs and one failed dispatched run. Inject a quota snapshot with settled and reserved spend. Assert:

```ts
expect(payload.costs).toEqual({
  estimated: true,
  currency: "USD",
  pricingAsOf,
  settledSpend: {
    todayUsd: 0.4,
    monthToDateUsd: 0.9,
    mayIncludeConservativeSettlements: true,
  },
  completedRunEstimates: {
    todayUsd: 0.08,
    monthToDateUsd: 0.2,
    completedModelRuns: 2,
    totalUsd: 0.2,
    averageUsd: 0.1,
  },
  byModel: expect.any(Array),
  byFamily: expect.any(Array),
  dailyBudget: {
    limitUsd: 5,
    settledUsd: 0.4,
    reservedUsd: 1,
    remainingUsd: 3.6,
    pendingReservations: 1,
  },
});
```

Assert `remainingUsd` is clamped at zero. Assert no snapshot bucket map or reservation ID is serialized.

Assert:

```ts
expect(payload.retention.expiryBuckets).toEqual({
  lessThanOneHour: 1,
  oneToSixHours: 1,
  sixToTwentyFourHours: 1,
});
expect(payload.retention).toMatchObject({
  activeDocuments: 3,
  activePublicUploads: 0,
  cleanupBacklog: 0,
});
expect(payload.referenceQuality.observationCount).toBe(10);
expect(payload.referenceQuality.familyCounts).toEqual({
  supplier_invoice: 5,
  warehouse_goods_receipt: 5,
});
expect(payload.referenceQuality.classificationCounts).toEqual({
  correct: 2,
  attention: 4,
  incorrect: 4,
});
expect(payload.referenceQuality).toMatchObject({
  unreadableCriticalEvidenceDetected: 2,
  unreadableCriticalEvidenceFixtures: 2,
  unreadableCriticalEvidenceDetectionRate: 1,
});
expect(payload.referenceQuality.falseClearCount).toBe(0);
```

- [ ] **Step 2: Run metrics tests and confirm failure**

```powershell
npx vitest run tests/unit/server/metrics-handler.test.ts tests/contract/routes/metrics-cron.test.ts
```

Expected: FAIL because cost, expiry and ten-fixture quality fields do not exist.

- [ ] **Step 3: Fetch all sources once per cache fill**

Use:

```ts
const [aggregate, confirmedCosts, quota, runs, lifecycle, cleanupBacklog] =
  await Promise.all([
    container.repository.aggregateAnonymousUsage(),
    container.repository.aggregateConfirmedModelCosts(now),
    container.quotaRepository.snapshot(now),
    container.repository.listPublicRuns(now, {
      limit: METRICS_RUN_LIMIT,
      offset: 0,
      includeDetails: true,
    }),
    container.repository.aggregateActiveDetailLifecycle(now),
    container.repository.countCleanupBacklog(now),
  ]);
```

Do not expose raw `quota`. Serialize only the safe cost fields listed in Step 1.

- [ ] **Step 4: Calculate operational workflow and quality data**

Count workflow state from terminal run status and outcome. Map `clear` plus `evidence_consistent` to ready, `needs_review` plus `conflict` to needs attention, `incomplete` plus `not_found` to incomplete and `failed` to processing errors. Count the latest workflow event separately by event status. Publish:

```ts
operations: {
  workflowStatus: {
    ready: number;
    needsAttention: number;
    incomplete: number;
    processingErrors: number;
  }
  workflowActivity: {
    prepared: number;
    staged: number;
    simulated: number;
  }
  performance: {
    completionRate: number;
    failureRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    retryCount: number;
    averageStepDurationsMs: Record<string, number>;
  }
  lifecycle: {
    activeDocuments: number;
    activePublicUploads: number;
    expiryBuckets: ExpiryBucketCounts;
    cleanupBacklog: number;
  }
}
```

Extend `calculateRecordedFixtureBenchmark` to count fixtures by family and classification. Define unreadable-critical-evidence detection as a rate. The numerator counts unreadable fixtures that produce an incomplete outcome plus a `not_found` result for the handwritten comments field. The denominator counts fixtures whose `attentionReason` is `unreadable_critical_evidence`. Return numerator, denominator and rate so the two-of-two result is unambiguous.

Set both `operations.lifecycle` and the compatibility `retention` object from `lifecycle`. Do not derive active-document or expiry counts from the 100-row explorer list.

- [ ] **Step 5: Calculate costs without recorded-run dilution**

Use `quota.globalSpendUsd` and `quota.monthToDateSpendUsd` for settled spend. This ledger may include conservative settlement for a failed dispatched request. Keep that population separate from `confirmedCosts.todayEstimatedCostUsd` and `confirmedCosts.monthToDateEstimatedCostUsd`, which cover completed confirmed model runs only.

Use `confirmedCosts.averageEstimatedCostUsd` for both the completed-run estimate panel and `resourceScenario.modelCostAssumption.averageModelCostPerRunUsd`. Never divide `aggregate.estimatedCostUsd` by all completed runs.

Set:

```ts
const remainingUsd = Math.max(
  0,
  quota.dailyBudgetUsd - quota.globalSpendUsd - quota.reservedSpendUsd,
);
```

Keep `usage` during compatibility but populate its input tokens, output tokens and provider split from `confirmedCosts`. Do not source those fields from `aggregateAnonymousUsage()`. Add a metrics-handler assertion that a recorded row with nonzero persisted tokens remains absent from `usage` and `costs`.

- [ ] **Step 6: Run metrics tests**

```powershell
npx vitest run tests/unit/server/metrics-handler.test.ts tests/contract/routes/metrics-cron.test.ts
```

Expected: PASS with ten reference observations, truthful budget totals and confirmed-model averages.

- [ ] **Step 7: Commit the metrics contract**

```powershell
git add src/server/http/metrics-handler.ts tests/unit/server/metrics-handler.test.ts tests/contract/routes/metrics-cron.test.ts
git commit -m "feat: separate operations and cost metrics"
```

---

### Task 4: Build the responsive Operations and Costs workspace

**Files:**

- Modify: `src/components/operations/operations-dashboard.tsx`
- Create: `src/components/operations/operations-workspace.tsx`
- Create: `src/components/operations/costs-workspace.tsx`
- Modify: `src/components/operations/resource-calculator.tsx`
- Modify: `src/components/operations/run-explorer.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/component/operations.test.tsx`
- Modify: `tests/e2e/operations.spec.ts`

**Interfaces:**

- Consumes: The metrics contract from Task 3.
- Produces: Four top summary cards followed by a two-thirds Operations column and a one-third Costs column.
- Preserves: Run explorer query-string restoration and active same-origin document preview.

- [ ] **Step 1: Write failing component tests for the new layout**

Render a populated payload and assert these region headings:

```ts
expect(
  screen.getByRole("heading", { name: "Operations workspace" }),
).toBeVisible();
expect(screen.getByRole("heading", { name: "Costs workspace" })).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Processing performance" }),
).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Reference quality suite" }),
).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Settled API spend estimate" }),
).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Completed-run cost estimates" }),
).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Confirmed provider usage" }),
).toBeVisible();
expect(
  screen.getByRole("heading", { name: "Daily model budget" }),
).toBeVisible();
```

Assert visible p50, p95, retry count and average step durations. Assert the expiry labels are exactly `Less than 1 hour`, `1 to 6 hours` and `6 to 24 hours`.

Assert `Unreadable critical evidence detection` renders `100%` with `2 of 2 fixtures` so the metric cannot be mistaken for a count.

Assert recorded-only metrics show `US$0.00` and `No confirmed model runs` instead of an artificial zero-dollar average.

Assert all old phrases are absent:

```ts
expect(
  screen.queryByText(
    /live-call|live provider|public prototype|recorded replay/i,
  ),
).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the component test and confirm failure**

```powershell
npx vitest run tests/component/operations.test.tsx
```

Expected: FAIL because the current page renders a four-panel signal grid and hides performance metrics.

- [ ] **Step 3: Add typed client metrics contracts**

Move the page-local `Metrics` type into `operations-dashboard.tsx` as a contract that mirrors Task 3. Pass `operations`, `referenceQuality`, `costs`, `runExplorer` and `resourceScenario` to focused child components.

The dashboard remains responsible for fetch, retry, loading and the four summary cards. `OperationsWorkspace` owns workflow, performance, quality, retention and explorer panels. `CostsWorkspace` owns spend, provider usage, model and family breakdowns, daily budget and the resource calculator.

- [ ] **Step 4: Build the Operations column**

Render these panels in this order:

1. Workflow status
2. Processing performance
3. Reference quality suite
4. Document lifecycle
5. Run explorer and selected detail

Use text plus `<progress>` only where a proportion has a meaningful maximum. Render average step durations as a sorted definition list. The reference panel states `Provider-neutral contract baseline` and never implies measured model accuracy.

- [ ] **Step 5: Build the Costs column**

Render:

1. Settled API spend estimate today and month to date with a conservative-settlement note
2. Completed-run cost estimates with today, month-to-date and average values
3. Confirmed input tokens, output tokens and provider split
4. Cost and run count by model
5. Average by document family
6. Daily budget with used, reserved and remaining values
7. Illustrative resource scenario

Use `Intl.NumberFormat("en-SG", { style: "currency", currency: "USD" })` for API values. Show the dated `pricingAsOf` label in both cost panels. State that settled spend can include a conservative charge for a dispatched failure while completed-run estimates exclude failures and fallback runs. Continue converting only the resource calculator's per-run assumption to SGD with the clearly stated illustrative exchange-rate assumption.

- [ ] **Step 6: Rename and enrich the run explorer**

Change `Live-call provider filter` to `Processing model filter`. The filter value remains actual provider-derived model attribution and excludes non-dispatched rows when a provider or model filter is active.

Add columns or compact row metadata for `documentFamily`, `variantLabel`, confirmed model, outcome, latest workflow action and latency. Active detail adds:

- `What differed` from failed evaluator fields and fixture differences
- Comments field evidence
- Workflow activity timeline
- Safe diagnostic codes

Derive `variantLabel` by joining `fixtureId` against the committed `syntheticFixtures` catalogue. Show `Custom upload` when `sourceType === "custom"` and `Legacy run` when no current fixture matches. Never derive a provider claim from fixture metadata.

Do not show configured provider or configured model as if called. A non-dispatched row displays `No AI processing` in the model column.

- [ ] **Step 7: Add the two-column responsive CSS**

Use:

```css
.operations-costs-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(19rem, 1fr);
  align-items: start;
  gap: 1rem;
}

@media (max-width: 960px) {
  .operations-costs-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

Keep tables horizontally scrollable within their own region. Do not allow the page root to exceed the viewport width at 390 pixels.

- [ ] **Step 8: Run component and browser tests**

```powershell
npx vitest run tests/component/operations.test.tsx
npx playwright test tests/e2e/operations.spec.ts
```

Expected: PASS for truthful labels, cost exclusion, visible performance data, explorer filtering and responsive stacking.

- [ ] **Step 9: Commit the dashboard redesign**

```powershell
git add src/components/operations/operations-dashboard.tsx src/components/operations/operations-workspace.tsx src/components/operations/costs-workspace.tsx src/components/operations/resource-calculator.tsx src/components/operations/run-explorer.tsx src/app/globals.css tests/component/operations.test.tsx tests/e2e/operations.spec.ts
git commit -m "feat: split operations and costs dashboard"
```

---

### Task 5: Verify dashboard claims and production behavior

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/evaluation-report.md`
- Modify: `docs/privacy-and-retention.md`

**Interfaces:**

- Consumes: Completed document, workflow and dashboard plans.
- Produces: Documented metric populations and a green production-ready regression baseline.

- [ ] **Step 1: Add documentation assertions to the existing test matrix**

Assert the evaluation document identifies ten provider-neutral fixtures and zero provider claims for fallback observations. Assert architecture documentation defines completed confirmed-model cost, settled budget and reserved budget as different populations.

- [ ] **Step 2: Update public documentation**

Document:

- Workflow, performance and explorer detail inspect the latest 100 public run summaries.
- Summary, lifecycle, quota and cost aggregates use their repository-wide anonymous populations.
- Reference quality uses exactly ten deterministic fixture observations.
- Completed-model cost uses dispatched completed runs with trustworthy usage.
- Settled spend today and month to date comes from the quota ledger and may include conservative settlement.
- Daily budget includes today's settled cost plus active reservations.
- Failed dispatched requests may appear in settled spend without entering the completed-model estimate or average.
- Resource savings remain illustrative rather than measured.

- [ ] **Step 3: Run the full verification suite**

```powershell
npm run lint
npm run typecheck
npm test
npx playwright test
npm run build:production
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Inspect production bundles for forbidden claims**

```powershell
rg -n -i "live-call|live provider|public prototype|recorded replay|measured savings" .next/static .next/server/app
```

Expected: no normal-interface occurrence of the first four phrases. `measured savings` may appear only inside the explicit `not measured savings` disclaimer.

- [ ] **Step 5: Commit dashboard documentation**

```powershell
git add README.md docs/architecture.md docs/evaluation-report.md docs/privacy-and-retention.md
git commit -m "docs: define operations and cost metrics"
```
