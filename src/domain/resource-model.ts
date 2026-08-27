import type { ResourceScenarioResult } from "./types";

export function calculateResourceScenario(input: {
  documents: number;
  fields: number;
  manualMinutesPerField: number;
  assistedMinutesPerField: number;
  loadedHourlyCost: number;
  averageModelCostPerRun: number;
}): ResourceScenarioResult {
  const fieldChecks = input.documents * input.fields;
  const manualHours = (fieldChecks * input.manualMinutesPerField) / 60;
  const assistedHours = (fieldChecks * input.assistedMinutesPerField) / 60;
  const manualLaborCost = manualHours * input.loadedHourlyCost;
  const assistedLaborCost = assistedHours * input.loadedHourlyCost;
  const modelCost = input.documents * input.averageModelCostPerRun;

  return {
    manualHours,
    assistedHours,
    hoursSaved: manualHours - assistedHours,
    manualLaborCost,
    assistedLaborCost,
    modelCost,
    totalAssistedCost: assistedLaborCost + modelCost,
    illustrative: true,
  };
}
