import { describe, expect, it } from "vitest";
import {
  buildDisplayTrace,
  type RawTraceState,
} from "@/components/workbench/trace-model";
import type { RunStatus } from "@/domain/types";

function traceState(
  entries: Partial<Record<RunStatus, RawTraceState>>,
): Partial<Record<RunStatus, RawTraceState>> {
  return entries;
}

describe("Workbench display trace", () => {
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
        label: "Resolve and prepare action",
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
