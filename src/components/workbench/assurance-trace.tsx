"use client";

import { useId } from "react";
import type { RunStatus } from "@/domain/types";
import { Button, StatusMark } from "@/components/ui/primitives";
import type { DisplayTraceStage } from "./trace-model";

export function AssuranceTrace({
  displayTrace,
  terminalStatus,
  elapsedMs,
  expanded,
  onExpandedChange,
}: {
  displayTrace: readonly DisplayTraceStage[];
  terminalStatus: Extract<RunStatus, "completed" | "failed"> | null;
  elapsedMs: number | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const traceId = useId();
  const completedCount = displayTrace.filter((stage) => stage.status === "pass").length;
  const terminal = terminalStatus !== null;

  return (
    <div className="assurance-trace">
      {terminal ? (
        <div className="trace-disclosure">
          <div>
            <strong>{terminalStatus === "completed" ? "Review complete" : "Review stopped"}</strong>
            {terminalStatus === "completed" ? (
              <p>
                {completedCount} of {displayTrace.length} steps complete
                {elapsedMs === null ? null : <> · {(elapsedMs / 1000).toFixed(1)} s</>}
              </p>
            ) : (
              <p>Review the completed and affected stages before choosing a recovery action.</p>
            )}
          </div>
          <Button
            type="button"
            intent="neutral"
            className="trace-disclosure__toggle"
            aria-expanded={expanded}
            aria-controls={traceId}
            onClick={() => onExpandedChange(!expanded)}
          >
            View review steps
          </Button>
        </div>
      ) : null}
      <ol id={traceId} className="trace-list" hidden={terminal && !expanded}>
        {displayTrace.map((stage) => (
          <li key={stage.key} className={stage.status === "active" ? "trace-active" : ""}>
            <StatusMark status={stage.status} />
            <span>
              <strong>{stage.label}</strong>
              <small>
                {stage.status === "active"
                  ? "In progress"
                  : stage.status === "pass"
                    ? "Completed"
                    : stage.status === "error"
                      ? "Needs attention"
                      : "Pending"}
              </small>
            </span>
            <time>{stage.duration === null ? "—" : `${(stage.duration / 1000).toFixed(1)} s`}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}
