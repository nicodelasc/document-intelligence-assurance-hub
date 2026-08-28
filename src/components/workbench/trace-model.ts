import type { RunStatus } from "@/domain/types";

export type TraceStageStatus = "idle" | "active" | "pass" | "error";

export type RawTraceState = {
  status: TraceStageStatus;
  duration: number | null;
};

export type DisplayTraceStage = {
  key: "understand" | "verify" | "resolve";
  label: string;
  rawStages: readonly RunStatus[];
  status: TraceStageStatus;
  duration: number | null;
};

const DISPLAY_STAGE_DEFINITIONS = [
  {
    key: "understand",
    label: "Understand document",
    rawStages: ["validating", "storing", "extracting"],
  },
  {
    key: "verify",
    label: "Verify evidence",
    rawStages: ["verifying"],
  },
  {
    key: "resolve",
    label: "Resolve and prepare action",
    rawStages: ["comparing", "deciding"],
  },
] as const satisfies ReadonlyArray<{
  key: DisplayTraceStage["key"];
  label: string;
  rawStages: readonly RunStatus[];
}>;

function groupStatus(states: RawTraceState[]): TraceStageStatus {
  if (states.some((state) => state.status === "error")) return "error";
  if (states.every((state) => state.status === "pass")) return "pass";
  if (states.some((state) => state.status === "active" || state.status === "pass")) {
    return "active";
  }
  return "idle";
}

export function buildDisplayTrace(
  rawTrace: Partial<Record<RunStatus, RawTraceState>>,
): DisplayTraceStage[] {
  return DISPLAY_STAGE_DEFINITIONS.map((definition) => {
    const states = definition.rawStages.map(
      (stage) => rawTrace[stage] ?? { status: "idle" as const, duration: null },
    );
    const status = groupStatus(states);
    return {
      ...definition,
      status,
      duration:
        status === "pass"
          ? states.reduce((total, state) => total + (state.duration ?? 0), 0)
          : null,
    };
  });
}
