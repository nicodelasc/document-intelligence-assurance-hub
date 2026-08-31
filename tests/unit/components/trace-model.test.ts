import { describe, expect, it } from "vitest";
import {
  buildDisplayTrace,
  failActiveTrace,
  nextDisplayStageAnnouncement,
  type RawTraceState,
} from "@/components/workbench/trace-model";
import type { RunStatus } from "@/domain/types";

function traceState(
  entries: Partial<Record<RunStatus, RawTraceState>>,
): Partial<Record<RunStatus, RawTraceState>> {
  return entries;
}

describe("Workbench display trace", () => {
  it("announces grouped stages once and never announces publishing", () => {
    let previous: "understand" | "verify" | "resolve" | null = null;
    const messages: string[] = [];
    for (const rawStage of [
      "validating",
      "storing",
      "extracting",
      "verifying",
      "comparing",
      "deciding",
      "publishing",
    ] as const) {
      const next = nextDisplayStageAnnouncement(rawStage, previous);
      previous = next.key;
      if (next.message) messages.push(next.message);
    }

    expect(messages).toEqual([
      "Understand document started.",
      "Verify evidence started.",
      "Triage exception and prepare handoff started.",
    ]);
  });

  it("marks an active visible group failed and stops its active state", () => {
    const failed = failActiveTrace(
      traceState({
        validating: { status: "pass", duration: 20 },
        storing: { status: "pass", duration: 30 },
        extracting: { status: "active", duration: null },
      }),
    );

    expect(buildDisplayTrace(failed)[0]).toMatchObject({
      label: "Understand document",
      status: "error",
    });
    expect(Object.values(failed).some((state) => state?.status === "active")).toBe(false);
  });

  it("projects a publishing failure onto the final visible group", () => {
    const failed = failActiveTrace(
      traceState({
        validating: { status: "pass", duration: 10 },
        storing: { status: "pass", duration: 10 },
        extracting: { status: "pass", duration: 10 },
        verifying: { status: "pass", duration: 10 },
        comparing: { status: "pass", duration: 10 },
        deciding: { status: "pass", duration: 10 },
        publishing: { status: "active", duration: null },
      }),
    );

    const display = buildDisplayTrace(failed);
    expect(display).toHaveLength(3);
    expect(display.at(-1)).toMatchObject({
      label: "Triage exception and prepare handoff",
      status: "error",
    });
    expect(display.flatMap((stage) => stage.rawStages)).not.toContain("publishing");
    expect(Object.values(failed).some((state) => state?.status === "active")).toBe(false);
  });

  it("maps raw workflow stages into three operational groups", () => {
    const display = buildDisplayTrace(
      traceState({
        validating: { status: "pass", duration: 20 },
        storing: { status: "pass", duration: 30 },
        extracting: { status: "active", duration: null },
        verifying: { status: "pass", duration: 40 },
        comparing: { status: "pass", duration: 10 },
        deciding: { status: "error", duration: null },
      }),
    );

    expect(display.map(({ label, status, duration }) => ({ label, status, duration }))).toEqual([
      {
        label: "Understand document",
        status: "active",
        duration: null,
      },
      {
        label: "Verify evidence",
        status: "pass",
        duration: 40,
      },
      {
        label: "Triage exception and prepare handoff",
        status: "error",
        duration: null,
      },
    ]);
  });

  it("excludes publishing without letting it change the visible trace", () => {
    const display = buildDisplayTrace(
      traceState({
        validating: { status: "pass", duration: 10 },
        storing: { status: "pass", duration: 10 },
        extracting: { status: "pass", duration: 10 },
        verifying: { status: "pass", duration: 10 },
        comparing: { status: "pass", duration: 10 },
        deciding: { status: "pass", duration: 10 },
        publishing: { status: "active", duration: null },
      }),
    );

    expect(display).toHaveLength(3);
    expect(display.flatMap((stage) => stage.rawStages)).not.toContain("publishing");
    expect(display.every((stage) => stage.status === "pass")).toBe(true);
  });
});
