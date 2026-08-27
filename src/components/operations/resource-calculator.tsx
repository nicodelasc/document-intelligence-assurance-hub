"use client";

import { useMemo, useState } from "react";
import { calculateResourceScenario } from "@/domain/resource-model";

const currency = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export function ResourceCalculator({ averageModelCostPerRun }: { averageModelCostPerRun: number }) {
  const [inputs, setInputs] = useState({
    documents: 200,
    fields: 3,
    manualMinutesPerField: 2,
    assistedMinutesPerField: 0.5,
    loadedHourlyCost: 50,
  });
  const result = useMemo(() => calculateResourceScenario({ ...inputs, averageModelCostPerRun }), [averageModelCostPerRun, inputs]);
  const netSavings = result.manualLaborCost - result.totalAssistedCost;
  const fields: Array<[keyof typeof inputs, string, number]> = [
    ["documents", "Documents each month", 1],
    ["fields", "Fields per document", 1],
    ["manualMinutesPerField", "Manual minutes per field", 0.1],
    ["assistedMinutesPerField", "Assisted minutes per field", 0.1],
    ["loadedHourlyCost", "Loaded hourly cost (S$)", 1],
  ];
  return (
    <div className="calculator">
      <p className="claim-label">Illustrative scenario — not measured savings</p>
      <div className="calculator__inputs">
        {fields.map(([key, label, step]) => (
          <label key={key}>
            <span>{label}</span>
            <input type="number" min="0" step={step} value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: Math.max(0, Number(event.target.value)) }))} />
          </label>
        ))}
      </div>
      <dl className="calculator__results">
        <div><dt>Hours saved each month</dt><dd>{result.hoursSaved.toFixed(1)} h <small>Illustrative</small></dd></div>
        <div><dt>Manual cost</dt><dd>{currency.format(result.manualLaborCost)} <small>Illustrative</small></dd></div>
        <div><dt>Assisted cost</dt><dd>{currency.format(result.totalAssistedCost)} <small>Illustrative</small></dd></div>
        <div className="calculator__net"><dt>Estimated net savings</dt><dd>{currency.format(netSavings)} <small>Illustrative</small></dd></div>
      </dl>
    </div>
  );
}
