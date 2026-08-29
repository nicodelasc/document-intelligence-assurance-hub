import type { FieldResult, Outcome } from "./types";

export function decideOutcome(input: {
  sourceType: "synthetic" | "custom";
  fields: FieldResult[];
}): Outcome {
  if (input.sourceType === "synthetic") {
    if (input.fields.some((field) => field.extractedValue === null))
      return "incomplete";
    if (
      input.fields.some(
        (field) =>
          field.evaluatorStatus === "conflict" ||
          field.referenceMatch === false,
      )
    ) {
      return "needs_review";
    }
    return "clear";
  }

  if (
    input.fields.some(
      (field) =>
        field.extractedValue === null || field.evaluatorStatus === "not_found",
    )
  ) {
    return "not_found";
  }
  if (input.fields.some((field) => field.evaluatorStatus === "conflict")) {
    return "conflict";
  }
  return "evidence_consistent";
}
