import { describe, expect, it } from "vitest";
import { calculateResourceScenario } from "@/domain/resource-model";

const defaults = {
  documents: 200,
  fields: 3,
  manualMinutesPerField: 2,
  assistedMinutesPerField: 0.5,
  loadedHourlyCost: 50,
  averageModelCostPerRun: 0,
};

describe("calculateResourceScenario", () => {
  it("calculates the specified illustrative default labor scenario", () => {
    expect(calculateResourceScenario(defaults)).toMatchObject({
      manualHours: 20,
      assistedHours: 5,
      hoursSaved: 15,
      manualLaborCost: 1000,
      assistedLaborCost: 250,
      modelCost: 0,
      totalAssistedCost: 250,
      illustrative: true,
    });
  });

  it("adds model cost per document without presenting the result as measured", () => {
    expect(calculateResourceScenario({ ...defaults, averageModelCostPerRun: 0.02 })).toMatchObject({
      modelCost: 4,
      totalAssistedCost: 254,
      illustrative: true,
    });
  });
});
