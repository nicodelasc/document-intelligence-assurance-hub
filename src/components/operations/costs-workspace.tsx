import { RulePanel } from "@/components/ui/primitives";
import type { ConfirmedUsageMetrics, CostMetrics } from "./operations-dashboard";
import { ResourceCalculator } from "./resource-calculator";

const usd = new Intl.NumberFormat("en-SG", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const number = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 });
const familyLabels = {
  supplier_invoice: "Supplier invoice",
  warehouse_goods_receipt: "Warehouse goods receipt",
} as const;

export function CostsWorkspace({ costs, usage, usdToSgd }: {
  costs: CostMetrics;
  usage: ConfirmedUsageMetrics;
  usdToSgd: number;
}) {
  const confirmedRuns = costs.completedRunEstimates.completedModelRuns;
  const providerTotal = usage.providerSplit.openai + usage.providerSplit.anthropic;
  const committedBudget = costs.dailyBudget.settledUsd + costs.dailyBudget.reservedUsd;

  return (
    <aside className="workspace-column costs-column" aria-labelledby="costs-workspace-heading">
      <header className="workspace-heading">
        <p>Estimated model economics</p>
        <h2 id="costs-workspace-heading">Costs workspace</h2>
      </header>

      <RulePanel title="Settled API spend estimate" headingLevel={3}>
        <p className="claim-label">Estimated pricing as of {costs.pricingAsOf}</p>
        <dl className="cost-list">
          <div><dt>Today</dt><dd>{usd.format(costs.settledSpend.todayUsd)}</dd></div>
          <div><dt>Month to date</dt><dd>{usd.format(costs.settledSpend.monthToDateUsd)}</dd></div>
        </dl>
        <p className="chart-summary">Settled spend can include a conservative charge for a dispatched failure.</p>
      </RulePanel>

      <RulePanel title="Completed-run cost estimates" headingLevel={3}>
        <p className="claim-label">Estimated pricing as of {costs.pricingAsOf}</p>
        <dl className="cost-list">
          <div><dt>Today</dt><dd>{usd.format(costs.completedRunEstimates.todayUsd)}</dd></div>
          <div><dt>Month to date</dt><dd>{usd.format(costs.completedRunEstimates.monthToDateUsd)}</dd></div>
          <div><dt>Total retained estimate</dt><dd>{usd.format(costs.completedRunEstimates.totalUsd)}</dd></div>
          <div><dt>Average per confirmed model run</dt><dd>{confirmedRuns > 0 ? usd.format(costs.completedRunEstimates.averageUsd) : "No confirmed model runs"}</dd></div>
        </dl>
        <p className="chart-summary">Completed-run estimates exclude failures and fallback runs.</p>
      </RulePanel>

      <RulePanel title="Confirmed provider usage" headingLevel={3}>
        <dl className="cost-list">
          <div><dt>Input tokens</dt><dd>{number.format(usage.inputTokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{number.format(usage.outputTokens)}</dd></div>
          <div><dt>OpenAI confirmed runs</dt><dd>{usage.providerSplit.openai}</dd></div>
          <div><dt>Anthropic confirmed runs</dt><dd>{usage.providerSplit.anthropic}</dd></div>
        </dl>
        {providerTotal > 0 ? (
          <div className="metric-progress-list">
            <label><span>OpenAI share</span><progress aria-label="OpenAI confirmed provider share" max={providerTotal} value={usage.providerSplit.openai} /></label>
            <label><span>Anthropic share</span><progress aria-label="Anthropic confirmed provider share" max={providerTotal} value={usage.providerSplit.anthropic} /></label>
          </div>
        ) : <p className="empty-copy">No confirmed model runs</p>}
      </RulePanel>

      <RulePanel title="Cost by processing model" headingLevel={3}>
        {costs.byModel.length ? (
          <dl className="breakdown-list">
            {costs.byModel.map((row) => (
              <div key={`${row.provider}-${row.model}`}>
                <dt><strong>{row.model}</strong><small>{row.provider} · {row.runCount} run{row.runCount === 1 ? "" : "s"}</small></dt>
                <dd><strong>{usd.format(row.totalEstimatedCostUsd)}</strong><small>{usd.format(row.averageEstimatedCostUsd)} average</small></dd>
              </div>
            ))}
          </dl>
        ) : <p className="empty-copy">No confirmed model runs</p>}
      </RulePanel>

      <RulePanel title="Average cost by document family" headingLevel={3}>
        {costs.byFamily.length ? (
          <dl className="breakdown-list">
            {costs.byFamily.map((row) => (
              <div key={row.documentFamily}>
                <dt><strong>{familyLabels[row.documentFamily]}</strong><small>{row.runCount} run{row.runCount === 1 ? "" : "s"}</small></dt>
                <dd><strong>{usd.format(row.averageEstimatedCostUsd)}</strong><small>{usd.format(row.totalEstimatedCostUsd)} total</small></dd>
              </div>
            ))}
          </dl>
        ) : <p className="empty-copy">No confirmed document-family costs</p>}
      </RulePanel>

      <RulePanel title="Daily model budget" headingLevel={3}>
        <dl className="cost-list">
          <div><dt>Limit</dt><dd>{usd.format(costs.dailyBudget.limitUsd)}</dd></div>
          <div><dt>Settled</dt><dd>{usd.format(costs.dailyBudget.settledUsd)}</dd></div>
          <div><dt>Reserved</dt><dd>{usd.format(costs.dailyBudget.reservedUsd)}</dd></div>
          <div><dt>Remaining</dt><dd>{usd.format(costs.dailyBudget.remainingUsd)}</dd></div>
          <div><dt>Pending reservations</dt><dd>{costs.dailyBudget.pendingReservations}</dd></div>
        </dl>
        {costs.dailyBudget.limitUsd > 0 ? (
          <div className="metric-progress-list">
            <label><span>Committed today</span><progress aria-label="Daily model budget committed" max={costs.dailyBudget.limitUsd} value={Math.min(costs.dailyBudget.limitUsd, committedBudget)} /></label>
          </div>
        ) : null}
      </RulePanel>

      <RulePanel title="Illustrative resource scenario" headingLevel={3}>
        <ResourceCalculator averageModelCostPerRun={costs.completedRunEstimates.averageUsd * usdToSgd} usdToSgd={usdToSgd} />
      </RulePanel>
    </aside>
  );
}
