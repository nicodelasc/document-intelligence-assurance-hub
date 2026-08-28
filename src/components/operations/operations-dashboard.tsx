"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, KeylessNotice, RulePanel, StatusMark } from "@/components/ui/primitives";
import { pricingAsOf } from "@/domain/live-model-catalog";
import { ResourceCalculator } from "./resource-calculator";
import { RunExplorer, type ExplorerRun } from "./run-explorer";

type Metrics = {
  generatedAt: string;
  summary: { totalRuns: number; completionRate: number; reviewRate: number; failureRate: number };
  performance: { sampleCount: number; p50LatencyMs: number; p95LatencyMs: number; retryCount: number; averageStepDurationsMs: Record<string, number> };
  usage: { inputTokens: number; outputTokens: number; providerSplit: { openai: number; anthropic: number }; recordedRuns: number; liveRuns: number; estimatedApiCostUsd: number; pricingAsOf: string };
  benchmark: { source: string; observationCount: number; exactMatchRate: number; missingFieldRecall: number; evaluatorAgreement: number; falseClearCount: number };
  retention: { activePublicUploads: number; upcomingExpirations: number; cleanupBacklog: number; sampleCount: number };
  actions: {
    ready: number;
    needsReview: number;
    blocked: number;
    stagedDryRuns: number;
    population: {
      activeRuns: number;
      actionProposals: number;
      maximumRuns: number;
      detailExpiryHours: number;
    };
  };
  runExplorer: ExplorerRun[];
  resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: number; usdToSgd: number } };
};

const percent = new Intl.NumberFormat("en-SG", { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("en-SG", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-SG", { style: "currency", currency: "USD" });

export function OperationsDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    fetch("/api/metrics", { signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Operational metrics are temporarily unavailable.");
        return response.json();
      })
      .then((payload: Metrics) => setMetrics(payload))
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  if (error && !metrics) {
    return <main id="main-content" className="page"><header className="page-intro"><div><h1>Operations</h1><p>Review public-safe operational signals and deterministic synthetic quality.</p></div><KeylessNotice /></header><div className="route-error" role="alert"><h2>Operations could not load</h2><p>{error}</p><Button type="button" onClick={() => load()}>Retry metrics</Button></div></main>;
  }

  const summary = metrics?.summary ?? { totalRuns: 0, completionRate: 0, reviewRate: 0, failureRate: 0 };
  const usage = metrics?.usage ?? { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 0, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf };
  const benchmark = metrics?.benchmark ?? { source: "deterministic_synthetic_observations", observationCount: 0, exactMatchRate: 0, missingFieldRecall: 0, evaluatorAgreement: 0, falseClearCount: 0 };
  const retention = metrics?.retention ?? { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 0 };
  const actions = metrics?.actions ?? {
    ready: 0,
    needsReview: 0,
    blocked: 0,
    stagedDryRuns: 0,
    population: {
      activeRuns: 0,
      actionProposals: 0,
      maximumRuns: 100,
      detailExpiryHours: 24,
    },
  };
  const averageModelCost = (metrics?.resourceScenario.modelCostAssumption.averageModelCostPerRunUsd ?? 0) * (metrics?.resourceScenario.modelCostAssumption.usdToSgd ?? 1.35);
  const providerConfigurationTotal = usage.providerSplit.openai + usage.providerSplit.anthropic;

  return (
    <main id="main-content" className="page operations-page" aria-busy={loading}>
      <header className="page-intro"><div><h1>Operations</h1><p>Inspect public-safe runs, action readiness and illustrative resource assumptions.</p></div><KeylessNotice /></header>
      {loading ? <div className="loading-band" role="status">Loading operational ledger…</div> : null}
      <section className="metric-band" aria-label="Run summary metrics">
        <Metric label="Total runs" value={String(summary.totalRuns)} detail="Public runs" />
        <Metric label="Completion rate" value={percent.format(summary.completionRate)} detail="Current public run ledger" />
        <Metric label="Review rate" value={percent.format(summary.reviewRate)} detail="Needs-review or incomplete outcomes" />
        <Metric label="Failure rate" value={percent.format(summary.failureRate)} detail="Safe terminal failures" />
      </section>

      <section className="operations-signals" aria-label="Operational signals">
        <RulePanel title="Action readiness" className="action-readiness-panel">
          <p className="claim-label">Persisted run results · internal dry runs only</p>
          <dl className="action-readiness-list"><div><dt>Ready</dt><dd>{actions.ready}</dd></div><div><dt>Needs review</dt><dd>{actions.needsReview}</dd></div><div><dt>Blocked</dt><dd>{actions.blocked}</dd></div><div><dt>Staged dry runs</dt><dd>{actions.stagedDryRuns}</dd></div></dl>
          <p className="chart-summary">{actions.population.actionProposals} action proposal{actions.population.actionProposals === 1 ? "" : "s"} across {actions.population.activeRuns} active run{actions.population.activeRuns === 1 ? "" : "s"}.</p>
          <p className="chart-summary">Latest {actions.population.maximumRuns} runs inspected. Details expire within {actions.population.detailExpiryHours} hours.</p>
          <p className="chart-summary">Staging records preparation only. No external connector is called.</p>
        </RulePanel>
        <RulePanel title="Provider usage">
          <p className="claim-label">Live-run provider configuration · demo runs excluded</p>
          <dl className="usage-list"><div><dt>Input tokens</dt><dd>{number.format(usage.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>{number.format(usage.outputTokens)}</dd></div><div><dt>Estimated API cost</dt><dd>{usd.format(usage.estimatedApiCostUsd)}</dd></div></dl>
          <div className="provider-bars" aria-label="Live-run provider configuration text summary"><span>OpenAI {usage.providerSplit.openai} live runs</span><progress max={Math.max(1, providerConfigurationTotal)} value={usage.providerSplit.openai} /><span>Anthropic {usage.providerSplit.anthropic} live runs</span><progress max={Math.max(1, providerConfigurationTotal)} value={usage.providerSplit.anthropic} /></div>
          <p className="benchmark-coverage">Deterministic observations: {benchmark.observationCount} synthetic fixture{benchmark.observationCount === 1 ? "" : "s"}</p>
          <p className="chart-summary">Text summary: Live-call counts exclude deterministic benchmark scenarios.</p>
        </RulePanel>
        <RulePanel title="Synthetic benchmark quality">
          <p className="claim-label">Deterministic synthetic evidence · provider-neutral observations</p>
          <dl className="quality-list"><div><dt>Exact-match rate</dt><dd>{percent.format(benchmark.exactMatchRate)}</dd></div><div><dt>Missing-field recall</dt><dd>{percent.format(benchmark.missingFieldRecall)}</dd></div><div><dt>Evaluator agreement</dt><dd>{percent.format(benchmark.evaluatorAgreement)}</dd></div><div className="false-clear"><dt>False-clear count</dt><dd>{benchmark.falseClearCount}</dd></div></dl>
        </RulePanel>
        <RulePanel title="Retention">
          <dl className="quality-list"><div><dt>Active public uploads</dt><dd>{retention.activePublicUploads}</dd></div><div><dt>Upcoming expirations</dt><dd>{retention.upcomingExpirations}</dd></div><div><dt>Cleanup backlog</dt><dd>{retention.cleanupBacklog}</dd></div></dl>
          <p className="chart-summary">Active details expire before 24 hours. Aggregate benchmark references do not contain uploaded files.</p>
        </RulePanel>
      </section>

      <section className="operations-workspace">
        <RunExplorer runs={metrics?.runExplorer ?? []} onSelect={() => undefined} />
        <aside className="scenario-rail">
          <RulePanel title="Illustrative resource scenario"><ResourceCalculator averageModelCostPerRun={averageModelCost} /></RulePanel>
          <RulePanel title="Expiry timeline"><ul className="timeline-list"><li><StatusMark status="error" /><span>Less than 24 hours</span><strong>{retention.upcomingExpirations} runs</strong></li><li><StatusMark status="warning" /><span>24–72 hours</span><strong>0 runs</strong></li><li><StatusMark status="pass" /><span>More than 72 hours</span><strong>0 runs</strong></li></ul><p className="chart-summary">Public detailed data is never represented as retained beyond its approved window.</p></RulePanel>
        </aside>
      </section>
      {!metrics?.runExplorer.length ? <div className="operations-zero-note"><StatusMark status="active" /><span>No public traffic is being invented. Deterministic synthetic references keep the quality panels useful.</span></div> : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
