import { RulePanel, StatusMark } from "@/components/ui/primitives";
import type { MetricsSummary, OperationsMetrics, ReferenceQualityMetrics } from "./operations-dashboard";
import { operationsTourTargetIds } from "./guided-tour-config";
import { RunExplorer, type ExplorerRun } from "./run-explorer";

const percent = new Intl.NumberFormat("en-SG", { style: "percent", maximumFractionDigits: 1 });
const milliseconds = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });

function formatStage(stage: string): string {
  const normalized = stage.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function OperationsWorkspace({ operations, referenceQuality, runs, summary }: {
  operations: OperationsMetrics;
  referenceQuality: ReferenceQualityMetrics;
  runs: ExplorerRun[];
  summary: MetricsSummary;
}) {
  const stepDurations = Object.entries(operations.performance.averageStepDurationsMs)
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <section className="workspace-column operations-column" aria-labelledby="operations-workspace-heading">
      <header className="workspace-heading">
        <p>Review queue and assurance</p>
        <h2 id="operations-workspace-heading">Operations workspace</h2>
      </header>

      <RunExplorer runs={runs} onSelect={() => undefined} />

      <RulePanel
        title="Triage status"
        headingLevel={3}
        headerId={operationsTourTargetIds.workflowHealth}
        headerClassName="tour-target"
      >
        <dl className="workspace-stat-grid">
          <div><dt>Ready for posting review</dt><dd>{operations.workflowStatus.ready}</dd></div>
          <div><dt>Exception review required</dt><dd>{operations.workflowStatus.needsAttention}</dd></div>
          <div><dt>Awaiting readable evidence</dt><dd>{operations.workflowStatus.incomplete}</dd></div>
          <div><dt>Processing errors</dt><dd>{operations.workflowStatus.processingErrors}</dd></div>
        </dl>
        <p className="subsection-label">Prepared case handoffs</p>
        <dl className="inline-stat-list">
          <div><dt>Prepared</dt><dd>{operations.workflowActivity.prepared}</dd></div>
          <div><dt>Staged</dt><dd>{operations.workflowActivity.staged}</dd></div>
          <div><dt>Simulated</dt><dd>{operations.workflowActivity.simulated}</dd></div>
        </dl>
      </RulePanel>

      <RulePanel title="Processing performance" headingLevel={3}>
        <dl className="workspace-stat-grid performance-grid">
          <div><dt>Completion rate</dt><dd>{percent.format(summary.completionRate)}</dd></div>
          <div><dt>Failure rate</dt><dd>{percent.format(summary.failureRate)}</dd></div>
          <div><dt>p50 latency</dt><dd>{milliseconds.format(operations.performance.p50LatencyMs)} ms</dd></div>
          <div><dt>p95 latency</dt><dd>{milliseconds.format(operations.performance.p95LatencyMs)} ms</dd></div>
          <div><dt>Retries</dt><dd>{operations.performance.retryCount} retries</dd></div>
          <div><dt>Sample</dt><dd>{operations.performance.sampleCount} runs</dd></div>
        </dl>
        {summary.totalRuns > 0 ? (
          <div className="metric-progress-list">
            <label><span>Completed runs</span><progress aria-label="Completion rate" max={1} value={summary.completionRate} /></label>
            <label><span>Failed runs</span><progress aria-label="Failure rate" max={1} value={summary.failureRate} /></label>
          </div>
        ) : null}
        <p className="subsection-label">Average step durations</p>
        {stepDurations.length ? (
          <dl className="step-duration-list">
            {stepDurations.map(([stage, duration]) => (
              <div key={stage}><dt>{formatStage(stage)}</dt><dd>{milliseconds.format(duration)} ms</dd></div>
            ))}
          </dl>
        ) : <p className="empty-copy">No completed step durations are available.</p>}
      </RulePanel>

      <RulePanel
        title="Reference quality suite"
        headingLevel={3}
        headerId={operationsTourTargetIds.assuranceSafeguards}
        headerClassName="tour-target"
      >
        <p className="claim-label">Provider-neutral contract baseline</p>
        <dl className="quality-detail-list">
          <QualityRate label="Exact-match rate" value={referenceQuality.exactMatchRate} showProgress={referenceQuality.observationCount > 0} />
          <QualityRate label="Missing-field recall" value={referenceQuality.missingFieldRecall} showProgress={referenceQuality.observationCount > 0} />
          <QualityRate label="Evaluator agreement" value={referenceQuality.evaluatorAgreement} showProgress={referenceQuality.observationCount > 0} />
          <div>
            <dt>Unreadable critical evidence detection</dt>
            <dd>
              <strong>{percent.format(referenceQuality.unreadableCriticalEvidenceDetectionRate)}</strong>
              <small>{referenceQuality.unreadableCriticalEvidenceDetected} of {referenceQuality.unreadableCriticalEvidenceFixtures} fixtures</small>
              {referenceQuality.unreadableCriticalEvidenceFixtures > 0 ? (
                <progress aria-label="Unreadable critical evidence detection" max={referenceQuality.unreadableCriticalEvidenceFixtures} value={referenceQuality.unreadableCriticalEvidenceDetected} />
              ) : null}
            </dd>
          </div>
          <div className="false-clear"><dt>False-clear count</dt><dd><strong>{referenceQuality.falseClearCount}</strong></dd></div>
        </dl>
        <div className="quality-populations">
          <dl>
            <div><dt>Supplier invoices</dt><dd>{referenceQuality.familyCounts.supplier_invoice}</dd></div>
            <div><dt>Warehouse receipts</dt><dd>{referenceQuality.familyCounts.warehouse_goods_receipt}</dd></div>
          </dl>
          <dl>
            <div><dt>Correct</dt><dd>{referenceQuality.classificationCounts.correct}</dd></div>
            <div><dt>Needs attention</dt><dd>{referenceQuality.classificationCounts.attention}</dd></div>
            <div><dt>Incorrect</dt><dd>{referenceQuality.classificationCounts.incorrect}</dd></div>
          </dl>
        </div>
        <p className="chart-summary">Ten deterministic fixture observations define this assurance baseline. It is not a model-accuracy claim.</p>
      </RulePanel>

      <RulePanel title="Public demo retention" headingLevel={3}>
        <dl className="inline-stat-list lifecycle-summary">
          <div><dt>Active documents</dt><dd>{operations.lifecycle.activeDocuments}</dd></div>
          <div><dt>Active public uploads</dt><dd>{operations.lifecycle.activePublicUploads}</dd></div>
          <div><dt>Cleanup backlog</dt><dd>{operations.lifecycle.cleanupBacklog}</dd></div>
        </dl>
        <ul className="timeline-list" aria-label="Active detail expiry buckets">
          <li><StatusMark status="error" /><span>Less than 1 hour</span><strong>{operations.lifecycle.expiryBuckets.lessThanOneHour}</strong></li>
          <li><StatusMark status="warning" /><span>1 to 6 hours</span><strong>{operations.lifecycle.expiryBuckets.oneToSixHours}</strong></li>
          <li><StatusMark status="pass" /><span>6 to 24 hours</span><strong>{operations.lifecycle.expiryBuckets.sixToTwentyFourHours}</strong></li>
        </ul>
      </RulePanel>
    </section>
  );
}

function QualityRate({ label, value, showProgress }: { label: string; value: number; showProgress: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><strong>{percent.format(value)}</strong>{showProgress ? <progress aria-label={label} max={1} value={value} /> : null}</dd>
    </div>
  );
}
