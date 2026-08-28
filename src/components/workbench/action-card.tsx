"use client";

import { useState } from "react";
import type { ActionProposal } from "@/domain/types";
import { Button, StatusMark } from "@/components/ui/primitives";

function actionStatusLabel(action: ActionProposal): string {
  if (action.stagedAt) return "Action staged";
  if (action.status === "blocked") return "Action blocked";
  if (action.status === "needs_review") return "Review required";
  return "Ready to stage";
}

function stageErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "The action could not be staged. Retry safely.";
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return "The action could not be staged. Retry safely.";
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim()
    ? message
    : "The action could not be staged. Retry safely.";
}

export function ActionCard({
  runId,
  action,
}: {
  runId: string;
  action: ActionProposal;
}) {
  const [preparedAction, setPreparedAction] = useState(action);
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState("");

  async function stageAction() {
    if (
      staging ||
      preparedAction.status !== "ready" ||
      preparedAction.stagedAt
    ) {
      return;
    }
    setStaging(true);
    setError("");
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/stage-action`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        staging?: { action?: ActionProposal };
      };
      if (!response.ok || !payload.staging?.action) {
        throw new Error(stageErrorMessage(payload));
      }
      setPreparedAction(payload.staging.action);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The action could not be staged. Retry safely.",
      );
    } finally {
      setStaging(false);
    }
  }

  const statusLabel = actionStatusLabel(preparedAction);
  const stageAllowed = preparedAction.status === "ready" && !preparedAction.stagedAt;
  return (
    <article className="action-card" aria-labelledby={`action-title-${runId}`}>
      <header>
        <StatusMark
          status={
            preparedAction.stagedAt
              ? "pass"
              : preparedAction.status === "ready"
                ? "active"
                : preparedAction.status === "blocked"
                  ? "error"
                  : "warning"
          }
        />
        <div>
          <span className="action-card__status" role={preparedAction.stagedAt ? "status" : undefined}>{statusLabel}</span>
          <h3 id={`action-title-${runId}`}>{preparedAction.title}</h3>
        </div>
      </header>
      <p>{preparedAction.summary}</p>
      <dl>
        {preparedAction.payload.map((entry) => (
          <div key={`${entry.label}-${entry.value}`}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
      {preparedAction.instructionEvidence ? (
        <blockquote>
          <span>Document instruction{preparedAction.page ? ` · Page ${preparedAction.page}` : ""}</span>
          {preparedAction.instructionEvidence}
        </blockquote>
      ) : null}
      <p className="action-card__reason">{preparedAction.reason}</p>
      {!preparedAction.stagedAt ? (
        <Button
          type="button"
          onClick={() => void stageAction()}
          busy={staging}
          disabled={!stageAllowed}
        >
          {stageAllowed ? "Stage action" : statusLabel}
        </Button>
      ) : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </article>
  );
}
