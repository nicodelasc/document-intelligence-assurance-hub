"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, KeylessNotice, RulePanel, StatusMark } from "@/components/ui/primitives";
import { ResourceCalculator } from "./resource-calculator";
import { RunExplorer, type ExplorerRun } from "./run-explorer";

type Metrics = {
  generatedAt: string;
  summary: { totalRuns: number; completionRate: number; reviewRate: number; failureRate: number };
  performance: { sampleCount: number; p50LatencyMs: number; p95LatencyMs: number; retryCount: number; averageStepDurationsMs: Record<string, number> };
  usage: { inputTokens: number; outputTokens: number; providerSplit: { openai: number; anthropic: number }; recordedRuns: number; liveRuns: number; estimatedApiCostUsd: number; pricingAsOf: string };
  benchmark: { source: string; liveRuns: number; recordedRuns: number; providerCoverage: { openai: number; anthropic: number }; exactMatchRate: number; missingFieldRecall: number; evaluatorAgreement: number; falseClearCount: number };
  retention: { activePublicUploads: number; upcomingExpirations: number; cleanupBacklog: number; sampleCount: number };
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

  const stepData = useMemo(() => {
    const entries = Object.entries(metrics?.performance.averageStepDurationsMs ?? {});
    if (entries.length) return entries.map(([stage, duration]) => ({ stage: stage.replaceAll("_", " "), seconds: Number((duration / 1000).toFixed(2)) }));
    return [
      { stage: "Validate", seconds: 0.2 },
      { stage: "Store", seconds: 0.3 },
      { stage: "Extract", seconds: 1.5 },
      { stage: "Verify", seconds: 0.7 },
      { stage: "Compare", seconds: 0.4 },
      { stage: "Decide", seconds: 0.2 },
      { stage: "Publish", seconds: 0.1 },
    ];
  }, [metrics]);

  if (error && !metrics) {
    return <main id="main-content" className="page"><header className="page-intro"><div><h1>Operations</h1><p>Review public-safe operational signals and recorded benchmark quality.</p></div><KeylessNotice /></header><div className="route-error" role="alert"><h2>Operations could not load</h2><p>{error}</p><Button type="button" onClick={() => load()}>Retry metrics</Button></div></main>;
  }

  const summary = metrics?.summary ?? { totalRuns: 0, completionRate: 0, reviewRate: 0, failureRate: 0 };
  const performance = metrics?.performance ?? { sampleCount: 0, p50LatencyMs: 0, p95LatencyMs: 0, retryCount: 0, averageStepDurationsMs: {} };
  const usage = metrics?.usage ?? { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 0, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-27" };
  const benchmark = metrics?.benchmark ?? { source: "recorded_fixture_replay", liveRuns: 0, recordedRuns: 6, providerCoverage: { openai: 3, anthropic: 3 }, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 };
  const retention = metrics?.retention ?? { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 0 };
  const averageModelCost = (metrics?.resourceScenario.modelCostAssumption.averageModelCostPerRunUsd ?? 0) * (metrics?.resourceScenario.modelCostAssumption.usdToSgd ?? 1.35);

  return (
    <main id="main-content" className="page operations-page" aria-busy={loading}>
      <header className="page-intro"><div><h1>Operations</h1><p>Inspect prototype runs, recorded benchmark quality and illustrative resource assumptions.</p></div><KeylessNotice /></header>
      {loading ? <div className="loading-band" role="status">Loading operational ledger…</div> : null}
      <section className="metric-band" aria-label="Run summary metrics">
        <Metric label="Total runs" value={String(summary.totalRuns)} detail="Public runs" />
        <Metric label="Completion rate" value={percent.format(summary.completionRate)} detail="Current public run ledger" />
        <Metric label="Review rate" value={percent.format(summary.reviewRate)} detail="Needs-review or incomplete outcomes" />
        <Metric label="Failure rate" value={percent.format(summary.failureRate)} detail="Safe terminal failures" />
      </section>

      <section className="operations-signals" aria-label="Operational signals">
        <RulePanel title="Latency and step duration" className="chart-panel">
          <div className="signal-stat-row"><span><small>p50 latency</small><strong>{(performance.p50LatencyMs / 1000).toFixed(1)} s</strong></span><span><small>p95 latency</small><strong>{(performance.p95LatencyMs / 1000).toFixed(1)} s</strong></span><span><small>Retries</small><strong>{performance.retryCount}</strong></span></div>
          <div className="chart-with-summary">
            <div className="chart-frame" role="img" aria-label="Average recorded step duration bar chart">
              <ResponsiveContainer width="100%" height={190}><BarChart data={stepData} layout="vertical" margin={{ left: 18, right: 16 }}><CartesianGrid stroke="#E7EAF0" horizontal={false} /><XAxis type="number" unit="s" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="stage" width={62} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="seconds" fill="#155EEF" radius={[0, 2, 2, 0]} /></BarChart></ResponsiveContainer>
            </div>
            <p className="chart-summary">Text summary: {performance.sampleCount ? `${performance.sampleCount} active run records inform this view.` : "No public runs exist yet. The chart shows a recorded-reference stage profile without live timing claims."}</p>
          </div>
        </RulePanel>
        <RulePanel title="Provider usage">
          <p className="claim-label">Public run usage · benchmark coverage is separate</p>
          <dl className="usage-list"><div><dt>Input tokens</dt><dd>{number.format(usage.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>{number.format(usage.outputTokens)}</dd></div><div><dt>Estimated API cost</dt><dd>{usd.format(usage.estimatedApiCostUsd)}</dd></div></dl>
          <div className="provider-bars" aria-label="Public provider split text summary"><span>OpenAI {usage.providerSplit.openai} public runs</span><progress max={Math.max(1, summary.totalRuns)} value={usage.providerSplit.openai} /><span>Anthropic {usage.providerSplit.anthropic} public runs</span><progress max={Math.max(1, summary.totalRuns)} value={usage.providerSplit.anthropic} /></div>
          <p className="benchmark-coverage">Benchmark coverage: OpenAI {benchmark.providerCoverage.openai} · Anthropic {benchmark.providerCoverage.anthropic}</p>
          <p className="chart-summary">Text summary: Public run counts remain independent from the six recorded fixture-provider benchmark combinations.</p>
        </RulePanel>
        <RulePanel title="Synthetic benchmark quality">
          <p className="claim-label">Recorded benchmark data · six fixture-provider combinations</p>
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
      {!metrics?.runExplorer.length ? <div className="operations-zero-note"><StatusMark status="active" /><span>No public traffic is being invented. Recorded benchmark references keep the quality panels useful.</span></div> : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
