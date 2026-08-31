"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { workflowEventSchema } from "@/domain/run-schema";
import type {
  ActionProposal,
  DocumentClassification,
  DocumentFamily,
  EmailPreview,
  FieldResult,
  Outcome,
  RunStatus,
  WorkflowActionType,
  WorkflowEvent,
} from "@/domain/types";
import {
  allowedRecipientRoles,
  allowedWorkflowActionsForRun,
  workflowActionRequiresRecipient,
} from "@/domain/workflow-actions";
import { Button, StatusMark } from "@/components/ui/primitives";
import { EmailPreviewDialog } from "./email-preview-dialog";

type ActionControl = {
  action: WorkflowActionType;
  label: string;
  dialogTitle?: string;
  dialogDescription?: string;
  confirmLabel?: string;
};

const controlsByGroup = {
  clear: [
    { action: "approve_and_stage", label: "Prepare posting handoff" },
  ],
  needs_review: [
    {
      action: "assign_review",
      label: "Assign exception review",
      dialogTitle: "Assign exception review",
      dialogDescription: "Choose the synthetic role responsible for reviewing the exception.",
      confirmLabel: "Prepare assignment",
    },
    {
      action: "prepare_email",
      label: "Draft clarification request",
      dialogTitle: "Draft clarification request",
      dialogDescription: "Choose one synthetic business role for the prepared request.",
      confirmLabel: "Prepare request",
    },
  ],
  incomplete: [
    {
      action: "request_clearer_document",
      label: "Request clearer evidence",
      dialogTitle: "Request clearer evidence",
      dialogDescription: "Choose the synthetic role that should receive the evidence request.",
      confirmLabel: "Prepare request",
    },
    {
      action: "assign_review",
      label: "Assign manual review",
      dialogTitle: "Assign manual review",
      dialogDescription: "Choose the synthetic role that should review the evidence.",
      confirmLabel: "Prepare assignment",
    },
    { action: "replace_document", label: "Replace document" },
  ],
  failed: [{ action: "retry_processing", label: "Retry processing" }],
  guarded: [
    {
      action: "replace_document",
      label: "Replace with a supported procurement document",
    },
  ],
} as const satisfies Record<string, readonly ActionControl[]>;

type OutcomeGroup = "clear" | "needs_review" | "incomplete";

function groupForOutcome(outcome: Outcome): OutcomeGroup {
  if (outcome === "clear" || outcome === "evidence_consistent") return "clear";
  if (outcome === "needs_review" || outcome === "conflict") {
    return "needs_review";
  }
  return "incomplete";
}

function controlsForRun(
  status: RunStatus,
  outcome: Outcome | null,
  documentClassification: DocumentClassification | null,
): readonly ActionControl[] {
  const allowed = new Set(allowedWorkflowActionsForRun({
    status,
    outcome,
    documentClassification,
  }));
  const controls =
    documentClassification === "irrelevant" || documentClassification === "uncertain"
      ? controlsByGroup.guarded
      : status === "failed"
      ? controlsByGroup.failed
      : outcome === null
        ? []
        : controlsByGroup[groupForOutcome(outcome)];
  return controls.filter((control) => allowed.has(control.action));
}

function safeWorkflowError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "The workflow action could not be prepared. Retry safely.";
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return "The workflow action could not be prepared. Retry safely.";
  }
  const code = (error as { code?: unknown }).code;
  const messages: Record<string, string> = {
    workflow_rate_limited:
      "Workflow actions have been requested too frequently. Retry shortly.",
    workflow_not_authorized:
      "This browser no longer holds the capability required for workflow actions.",
    workflow_request_invalid: "The workflow action request was not accepted.",
    workflow_action_not_allowed:
      "This workflow action is not available for the run outcome.",
    workflow_recipient_not_allowed:
      "Select an allowed recipient role for this workflow action.",
    workflow_event_conflict:
      "The workflow event could not be created safely. Retry.",
    run_expired: "This run has expired and cannot accept workflow actions.",
    run_deleted: "This run was deleted and cannot accept workflow actions.",
    workflow_unavailable:
      "The workflow action is temporarily unavailable. Retry safely.",
  };
  return typeof code === "string" && messages[code]
    ? messages[code]
    : "The workflow action could not be prepared. Retry safely.";
}

function emailPreviewFromPayload(payload: unknown): EmailPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const preview = (payload as { emailPreview?: unknown }).emailPreview;
  if (!preview || typeof preview !== "object") return null;
  const record = preview as Record<string, unknown>;
  if (
    typeof record.recipientRole !== "string" ||
    typeof record.subject !== "string" ||
    typeof record.body !== "string" ||
    record.deliveryStatus !== "prepared_only_not_sent"
  ) {
    return null;
  }
  return {
    recipientRole: record.recipientRole.slice(0, 80),
    subject: record.subject.slice(0, 300),
    body: record.body.slice(0, 5000),
    deliveryStatus: "prepared_only_not_sent",
  };
}

function eventFromPayload(
  payload: unknown,
  runId: string,
  action: WorkflowActionType,
): WorkflowEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const workflow = (payload as { workflow?: unknown }).workflow;
  if (!workflow || typeof workflow !== "object") return null;
  const status = (workflow as { status?: unknown }).status;
  if (status !== "created" && status !== "already_created") return null;
  const parsed = workflowEventSchema.safeParse(
    (workflow as { event?: unknown }).event,
  );
  if (
    !parsed.success ||
    parsed.data.runId !== runId ||
    parsed.data.action !== action
  ) {
    return null;
  }
  return parsed.data;
}

function diagnosticLabel(code: string): string {
  return code.replaceAll("_", " ");
}

function downloadWorkflowSummary(input: {
  runId: string;
  status: RunStatus;
  outcome: Outcome | null;
  fields: readonly FieldResult[];
  safeDiagnosticCodes: readonly string[];
}) {
  const lines =
    input.status === "failed"
      ? [
          "Error summary - simulated workflow",
          `Run: ${input.runId}`,
          `Safe diagnostics: ${input.safeDiagnosticCodes.length ? input.safeDiagnosticCodes.join(" | ") : "Unavailable"}`,
        ]
      : [
          "Prepared summary - simulated workflow",
          `Run: ${input.runId}`,
          `Outcome: ${input.outcome ?? "Unavailable"}`,
          ...input.fields.map(
            (field) =>
              `${field.label}: ${field.extractedValue ?? "Not found"} | ${field.evaluatorStatus}`,
          ),
        ];
  const objectUrl = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download =
    input.status === "failed"
      ? "document-error-summary.txt"
      : "document-review-summary.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function WorkflowPanel({
  runId,
  status,
  outcome,
  proposal,
  capabilityToken,
  documentFamily,
  documentClassification = null,
  controlsAvailable = true,
  fields,
  safeDiagnosticCodes,
  onEvent,
  onReprocess,
  onRequestReplacement,
}: {
  runId: string;
  status: RunStatus;
  outcome: Outcome | null;
  proposal: ActionProposal | null;
  events: readonly WorkflowEvent[];
  capabilityToken: string;
  documentFamily: DocumentFamily | null;
  documentClassification?: DocumentClassification | null;
  controlsAvailable?: boolean;
  fields: readonly FieldResult[];
  safeDiagnosticCodes: readonly string[];
  onEvent: (event: WorkflowEvent) => void;
  onReprocess: () => void | Promise<void>;
  onRequestReplacement: () => void;
}) {
  const controls = useMemo(
    () => controlsAvailable
      ? controlsForRun(status, outcome, documentClassification)
      : [],
    [controlsAvailable, documentClassification, outcome, status],
  );
  const roles = allowedRecipientRoles(documentFamily);
  const [dialogAction, setDialogAction] =
    useState<WorkflowActionType | null>(null);
  const [recipientRole, setRecipientRole] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [pendingAction, setPendingAction] =
    useState<WorkflowActionType | null>(null);
  const [error, setError] = useState("");
  const pendingRef = useRef<WorkflowActionType | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
    };
  }, []);

  function closeDialog() {
    if (pendingRef.current) return;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setDialogAction(null);
    setRecipientRole("");
    setPreview(null);
    setError("");
  }

  function openRecipientDialog(control: ActionControl) {
    if (pendingRef.current) return;
    setDialogAction(control.action);
    setRecipientRole("");
    setPreview(null);
    setError("");
  }

  async function executeAction(
    action: WorkflowActionType,
    role: string | null,
  ) {
    if (pendingRef.current || !capabilityToken) return;
    pendingRef.current = action;
    setPendingAction(action);
    setError("");
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/workflow-actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-run-capability": capabilityToken,
          },
          body: JSON.stringify({ action, recipientRole: role }),
          signal: controller.signal,
        },
      );
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) throw new Error(safeWorkflowError(payload));
      const event = eventFromPayload(payload, runId, action);
      const nextPreview = emailPreviewFromPayload(payload);
      if (!event || (action === "prepare_email" && !nextPreview)) {
        throw new Error("The workflow response could not be verified. Retry safely.");
      }
      if (!mountedRef.current || controller.signal.aborted) return;
      onEvent(event);

      if (action === "prepare_email") {
        setPreview(nextPreview);
        return;
      }
      if (workflowActionRequiresRecipient(action)) {
        setDialogAction(null);
        setRecipientRole("");
      }
      if (action === "retry_processing") {
        await onReprocess();
      } else if (action === "replace_document") {
        onRequestReplacement();
      } else if (action === "download_summary") {
        downloadWorkflowSummary({
          runId,
          status,
          outcome,
          fields,
          safeDiagnosticCodes,
        });
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (!mountedRef.current || controller.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The workflow action could not be prepared. Retry safely.",
      );
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      if (mountedRef.current && pendingRef.current === action) {
        pendingRef.current = null;
        setPendingAction(null);
      }
    }
  }

  const dialogControl = dialogAction
    ? controls.find((control) => control.action === dialogAction) ?? null
    : null;

  return (
    <div className="workflow-panel">
      {proposal ? (
        <article className="workflow-proposal">
          <header>
            <StatusMark status={status === "failed" ? "error" : "active"} />
            <div>
              <span>Prepared handoff</span>
              <h3>{proposal.title}</h3>
            </div>
          </header>
          <p>{proposal.summary}</p>
          <dl>
            {proposal.payload.map((entry) => (
              <div key={`${entry.label}-${entry.value}`}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
          {proposal.instructionEvidence ? (
            <blockquote>
              <span>
                Document instruction
                {proposal.page ? ` · Page ${proposal.page}` : ""}
              </span>
              {proposal.instructionEvidence}
            </blockquote>
          ) : null}
          <p className="workflow-proposal__reason">{proposal.reason}</p>
        </article>
      ) : null}

      {status === "failed" ? (
        <div className="workflow-diagnostics">
          <strong>Safe diagnostic</strong>
          {safeDiagnosticCodes.length ? (
            <ul>
              {safeDiagnosticCodes.map((code) => (
                <li key={code}>{diagnosticLabel(code)}</li>
              ))}
            </ul>
          ) : (
            <p>No additional diagnostic code is available.</p>
          )}
        </div>
      ) : null}

      <div className="workflow-controls" aria-label="Document workflow actions">
        {controls.map((control, index) => (
          <Button
            key={control.action}
            type="button"
            intent={index === 0 ? "primary" : "neutral"}
            busy={pendingAction === control.action}
            disabled={Boolean(pendingAction) || !capabilityToken}
            onClick={() => {
              if (workflowActionRequiresRecipient(control.action)) {
                openRecipientDialog(control);
              } else {
                void executeAction(control.action, null);
              }
            }}
          >
            {control.label}
          </Button>
        ))}
      </div>
      {error && dialogAction === null ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <EmailPreviewDialog
        open={dialogControl !== null}
        title={dialogControl?.dialogTitle ?? "Prepare workflow action"}
        description={
          dialogControl?.dialogDescription ??
          "Choose one synthetic role for this prepared action."
        }
        roles={roles}
        recipientRole={recipientRole}
        confirmLabel={dialogControl?.confirmLabel ?? "Prepare action"}
        busy={pendingAction !== null}
        error={error}
        preview={preview}
        onRecipientRoleChange={(role) => {
          setRecipientRole(role);
          setError("");
        }}
        onConfirm={() => {
          if (dialogAction && recipientRole) {
            void executeAction(dialogAction, recipientRole);
          }
        }}
        onClose={closeDialog}
      />
    </div>
  );
}
