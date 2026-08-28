"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import type { ActionProposal, FieldResult, Outcome, Provider, RunEvent, RunStatus } from "@/domain/types";
import {
  recordedDocumentRunResults,
  syntheticFixtures,
} from "@/domain/fixtures";
import { liveModelCatalog } from "@/domain/live-model-catalog";
import { actionProposalSchema } from "@/domain/run-schema";
import { Button, EmptyState, KeylessNotice, LiveRegion, RulePanel, StatusMark } from "@/components/ui/primitives";
import { DangerDialog } from "@/components/ui/dialog";
import {
  ComparisonLedger,
  CustomUploadFields,
  ModelSelector,
  type ComparableRun,
  type CustomUploadHandle,
  type CustomUploadState,
  type ModelOption,
} from "./workbench-controls";
import { consumeNdjson } from "./run-stream";
import {
  buildDisplayTrace,
  failActiveTrace,
  nextDisplayStageAnnouncement,
  type DisplayTraceKey,
  type RawTraceState,
} from "./trace-model";
import { ActionCard } from "./action-card";

const rawTraceStages: RunStatus[] = [
  "validating",
  "storing",
  "extracting",
  "verifying",
  "comparing",
  "deciding",
  "publishing",
];

const outcomeLabel: Record<Outcome, string> = {
  clear: "Clear",
  needs_review: "Needs review",
  incomplete: "Incomplete",
  evidence_consistent: "Evidence-consistent",
  conflict: "Conflict",
  not_found: "Not found",
};

type TraceState = Partial<Record<RunStatus, RawTraceState>>;
type DeletionReceipt = { runId: string; token: string; expiresAt: string };
type ActionDetailStatus = "idle" | "loading" | "ready" | "error";

const outcomes = new Set<Outcome>(["clear", "needs_review", "incomplete", "evidence_consistent", "conflict", "not_found"]);

function freshTrace(): TraceState {
  return Object.fromEntries(rawTraceStages.map((stage) => [stage, { status: "idle", duration: null }]));
}

function safeStoreDeletion(runId: string, token: string, expiresAt: string) {
  try {
    localStorage.setItem(`assurance-delete:${runId}`, JSON.stringify({ token, expiresAt }));
  } catch {
    // Browser storage can be unavailable. The one-time receipt remains visible in this session.
  }
}

function removeStoredDeletion(runId: string) {
  try {
    localStorage.removeItem(`assurance-delete:${runId}`);
  } catch {
    // Storage cleanup is best effort. A missing browser store does not block server deletion.
  }
}

function restoreDeletionReceipts(now = Date.now()): DeletionReceipt[] {
  const restored: DeletionReceipt[] = [];
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("assurance-delete:")) continue;
      const runId = key.slice("assurance-delete:".length);
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<DeletionReceipt> | null;
        if (!parsed || typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string" || Date.parse(parsed.expiresAt) <= now) {
          localStorage.removeItem(key);
          continue;
        }
        restored.push({ runId, token: parsed.token, expiresAt: parsed.expiresAt });
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    return [];
  }
  return restored.sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt));
}

function comparisonValue(field: FieldResult): string {
  return `Extracted: ${field.extractedValue ?? "Not found"} · Normalized: ${field.normalizedValue ?? "Not found"}`;
}

function isProvider(value: unknown): value is Provider {
  return value === "openai" || value === "anthropic";
}

function comparableFromPublicPayload(payload: unknown): ComparableRun | null {
  if (!payload || typeof payload !== "object") return null;
  const run = (payload as { run?: unknown }).run;
  if (!run || typeof run !== "object") return null;
  const record = run as Record<string, unknown>;
  if (record.status === "expired" || record.status === "deleted") return null;
  if (typeof record.id !== "string" || typeof record.providerCalled !== "boolean") return null;
  if (record.executionMode !== "recorded" && record.executionMode !== "live") return null;
  if (!isProvider(record.configuredProvider) || typeof record.configuredModel !== "string") return null;
  if (record.providerCalled && (!isProvider(record.provider) || typeof record.model !== "string")) return null;
  if (!record.providerCalled && (record.provider !== null || record.model !== null)) return null;
  if (typeof record.outcome !== "string" || !outcomes.has(record.outcome as Outcome)) return null;
  const details = record.details && typeof record.details === "object" ? record.details as Record<string, unknown> : null;
  const result = details?.result && typeof details.result === "object" ? details.result as Record<string, unknown> : null;
  const rawFields = Array.isArray(result?.fields) ? result.fields : [];
  const fields = rawFields.filter((candidate): candidate is FieldResult => {
    if (!candidate || typeof candidate !== "object") return false;
    const item = candidate as Record<string, unknown>;
    return typeof item.key === "string" && typeof item.label === "string" && typeof item.evaluatorStatus === "string";
  });
  if (!fields.length) return null;
  return {
    id: record.id,
    providerCalled: record.providerCalled,
    provider: record.provider as Provider | null,
    model: record.model as string | null,
    configuredProvider: record.configuredProvider,
    configuredModel: record.configuredModel,
    executionMode: record.executionMode,
    requestedFields: fields.map((field) => field.label),
    values: fields.map(comparisonValue),
    evidence: fields.map((field) => field.evidence ?? "No evidence found"),
    evaluator: fields.map((field) => field.evaluatorStatus),
    latencyMs: typeof record.latencyMs === "number" ? record.latencyMs : typeof result?.latencyMs === "number" ? result.latencyMs : 0,
    outcome: record.outcome as Outcome,
  };
}

function actionFromPublicPayload(payload: unknown): ActionProposal | null {
  if (!payload || typeof payload !== "object") return null;
  const run = (payload as { run?: unknown }).run;
  if (!run || typeof run !== "object") return null;
  const details = (run as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const result = (details as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const action = (result as { action?: unknown }).action;
  if (!action || typeof action !== "object") return null;
  const parsed = actionProposalSchema.safeParse(action);
  return parsed.success ? parsed.data : null;
}

export function WorkbenchView() {
  const [source, setSource] = useState<"synthetic" | "custom">("synthetic");
  const [sampleId, setSampleId] = useState<(typeof syntheticFixtures)[number]["id"]>(syntheticFixtures[0].id);
  const [models, setModels] = useState<readonly ModelOption[]>(liveModelCatalog);
  const [selectedModel, setSelectedModel] = useState<string>(liveModelCatalog[0].id);
  const [custom, setCustom] = useState<CustomUploadState>({ file: null, fields: ["", ""], consent: false, valid: false });
  const [previewUrl, setPreviewUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceState>(freshTrace);
  const [fields, setFields] = useState<FieldResult[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preparedAction, setPreparedAction] = useState<ActionProposal | null>(null);
  const [actionRunId, setActionRunId] = useState("");
  const [actionCapability, setActionCapability] = useState("");
  const [actionDetailStatus, setActionDetailStatus] = useState<ActionDetailStatus>("idle");
  const [actionDetailError, setActionDetailError] = useState("");
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("Ready to review a document.");
  const [outcomeFocusVersion, setOutcomeFocusVersion] = useState(0);
  const [history, setHistory] = useState<ComparableRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [deletionReceipts, setDeletionReceipts] = useState<DeletionReceipt[]>([]);
  const [selectedDeletionId, setSelectedDeletionId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const cancellableRef = useRef(false);
  const configurationLockedRef = useRef(false);
  const requestRef = useRef(0);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const outcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const customUploadRef = useRef<CustomUploadHandle>(null);
  const startedRef = useRef(0);
  const lastStageRef = useRef<{ key: RunStatus; at: number } | null>(null);
  const lastAnnouncedDisplayStageRef = useRef<DisplayTraceKey | null>(null);
  const fieldAccumulatorRef = useRef<{ requestId: number; fields: Map<string, FieldResult> }>({ requestId: 0, fields: new Map() });
  const selectedDeletionReceipt = deletionReceipts.find((receipt) => receipt.runId === selectedDeletionId) ?? null;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setDeletionReceipts(restoreDeletionReceipts());
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function hydrateModels() {
      try {
        const response = await fetch("/api/models", { signal: controller.signal });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          models?: unknown;
          defaults?: Partial<Record<Provider, string>>;
        };
        if (!Array.isArray(payload.models)) return;
        const approvedModels = payload.models.filter(
          (candidate): candidate is ModelOption => {
            if (!candidate || typeof candidate !== "object") return false;
            const model = candidate as Record<string, unknown>;
            return (
              typeof model.id === "string" &&
              (model.provider === "openai" || model.provider === "anthropic") &&
              typeof model.displayName === "string" &&
              typeof model.recommended === "boolean"
            );
          },
        );
        if (!approvedModels.length || controller.signal.aborted || configurationLockedRef.current) return;
        setModels(approvedModels);
        const serverDefault = payload.defaults?.openai;
        setSelectedModel(
          approvedModels.some((model) => model.id === serverDefault)
            ? serverDefault!
            : approvedModels[0].id,
        );
      } catch {
        // The bundled approved catalogue keeps the selector usable if metadata refresh fails.
      }
    }
    async function hydrateHistory() {
      try {
        const response = await fetch("/api/runs?limit=12", { signal: controller.signal });
        if (!response.ok) throw new Error("history_unavailable");
        const payload = await response.json() as { runs?: unknown };
        const summaries = Array.isArray(payload.runs) ? payload.runs : [];
        const activeIds = summaries.flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object") return [];
          const record = candidate as Record<string, unknown>;
          if (record.status === "expired" || record.status === "deleted" || typeof record.id !== "string") return [];
          return [record.id];
        }).slice(0, 8);
        const settled = await Promise.allSettled(activeIds.map(async (runId) => {
          const detailResponse = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { signal: controller.signal });
          if (!detailResponse.ok) throw new Error("detail_unavailable");
          return comparableFromPublicPayload(await detailResponse.json());
        }));
        if (controller.signal.aborted) return;
        const hydrated = settled.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : []);
        setHistory((current) => [...current, ...hydrated.filter((run) => !current.some((existing) => existing.id === run.id))]);
        setHistoryError(settled.some((entry) => entry.status === "rejected") ? "Some active run details could not be loaded safely." : "");
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setHistoryError("Active public run history is temporarily unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    queueMicrotask(() => void hydrateModels());
    queueMicrotask(() => void hydrateHistory());
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (outcomeFocusVersion > 0) outcomeHeadingRef.current?.focus();
  }, [outcomeFocusVersion]);

  useEffect(() => {
    if (!custom.file) {
      queueMicrotask(() => setPreviewUrl(""));
      return;
    }
    const url = URL.createObjectURL(custom.file);
    queueMicrotask(() => setPreviewUrl(url));
    return () => URL.revokeObjectURL(url);
  }, [custom.file]);

  const fixture = useMemo(
    () =>
      recordedDocumentRunResults.find((candidate) => candidate.fixtureId === sampleId) ??
      recordedDocumentRunResults[0],
    [sampleId],
  );
  const selectedFixture =
    syntheticFixtures.find((candidate) => candidate.id === sampleId) ??
    syntheticFixtures[0];
  const selectedModelDefinition =
    models.find((model) => model.id === selectedModel) ?? models[0];
  const provider: Provider = selectedModelDefinition?.provider ?? "openai";
  const displayTrace = buildDisplayTrace(trace);

  const onStreamEvent = useCallback((event: RunEvent, requestId: number) => {
    if (requestId !== requestRef.current) return;
    const now = performance.now();
    if (event.type === "stage") {
      setTrace((current) => {
        const next = { ...current };
        if (lastStageRef.current) {
          next[lastStageRef.current.key] = { status: "pass", duration: now - lastStageRef.current.at };
        }
        next[event.stage] = { status: "active", duration: null };
        return next;
      });
      lastStageRef.current = { key: event.stage, at: now };
      const announcement = nextDisplayStageAnnouncement(
        event.stage,
        lastAnnouncedDisplayStageRef.current,
      );
      lastAnnouncedDisplayStageRef.current = announcement.key;
      if (announcement.message) setLiveMessage(announcement.message);
    } else if (event.type === "field") {
      if (fieldAccumulatorRef.current.requestId === requestId) {
        fieldAccumulatorRef.current.fields.set(event.field.key, event.field);
      }
      setFields((current) => [...current.filter((field) => field.key !== event.field.key), event.field]);
    }
  }, []);

  function rememberDeletionReceipt(runId: string, token: string) {
    const receipt = { runId, token, expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() };
    safeStoreDeletion(receipt.runId, receipt.token, receipt.expiresAt);
    setDeletionReceipts((current) => [receipt, ...current.filter((candidate) => candidate.runId !== receipt.runId)]);
  }

  async function loadPreparedAction(
    runId: string,
    requestId: number,
    signal: AbortSignal,
  ) {
    setActionDetailStatus("loading");
    setActionDetailError("");
    try {
      const detailResponse = await fetch(
        `/api/runs/${encodeURIComponent(runId)}`,
        { signal },
      );
      if (!detailResponse.ok) throw new Error("action_detail_unavailable");
      const resolvedAction = actionFromPublicPayload(await detailResponse.json());
      if (!resolvedAction) throw new Error("action_detail_unavailable");
      if (requestId !== requestRef.current) return;
      setPreparedAction(resolvedAction);
      setActionDetailStatus("ready");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      if (requestId !== requestRef.current) return;
      setPreparedAction(null);
      setActionDetailStatus("error");
      setActionDetailError("The prepared action is temporarily unavailable.");
    }
  }

  async function retryPreparedAction() {
    if (!actionRunId || actionDetailStatus === "loading") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current;
    try {
      await loadPreparedAction(actionRunId, requestId, controller.signal);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setActionDetailStatus("error");
        setActionDetailError("The prepared action is temporarily unavailable.");
      }
    } finally {
      if (requestId === requestRef.current) abortRef.current = null;
    }
  }

  async function runAssurance() {
    if (running || cancellableRef.current) return;
    cancellableRef.current = true;
    configurationLockedRef.current = true;
    setRunning(true);
    abortRef.current?.abort();
    abortRef.current = null;
    const requestId = ++requestRef.current;
    if (source === "custom") {
      const customValid = await customUploadRef.current?.validate();
      if (requestId !== requestRef.current) return;
      if (!customValid) {
        setError("Complete the document, field labels and consent before running a custom check.");
        cancellableRef.current = false;
        configurationLockedRef.current = false;
        setRunning(false);
        return;
      }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    fieldAccumulatorRef.current = { requestId, fields: new Map() };
    startedRef.current = performance.now();
    lastStageRef.current = null;
    lastAnnouncedDisplayStageRef.current = null;
    setError("");
    setOutcome(null);
    setPreparedAction(null);
    setActionRunId("");
    setActionCapability("");
    setActionDetailStatus("idle");
    setActionDetailError("");
    setFields([]);
    setTrace(freshTrace());
    setLiveMessage("Assurance run started.");
    const form = new FormData();
    form.set("sourceType", source);
    form.set("provider", provider);
    form.set("model", selectedModel);
    form.set("executionMode", source === "synthetic" ? "recorded" : "live");
    if (source === "synthetic") form.set("sampleId", sampleId);
    else if (custom.file) {
      form.set("document", custom.file);
      custom.fields.forEach((field) => form.append("requestedField", field));
      form.set("consent", String(custom.consent));
    }
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        body: form,
        headers: {
          "Idempotency-Key": crypto.randomUUID(),
          "X-Run-Source-Type": source,
          "X-Run-Execution-Mode": source === "synthetic" ? "recorded" : "live",
        },
        signal: controller.signal,
      });
      const terminal = await consumeNdjson(response, { onEvent: (event) => onStreamEvent(event, requestId) });
      if (requestId !== requestRef.current) return;
      const elapsed = performance.now() - startedRef.current;
      if (source === "custom" && terminal.runId && terminal.deletionToken) {
        rememberDeletionReceipt(terminal.runId, terminal.deletionToken);
      }
      if (terminal.type === "failed") {
        cancellableRef.current = false;
        setTrace((current) => failActiveTrace(current));
        lastStageRef.current = null;
        setError(terminal.message);
        setLiveMessage(`Run stopped. ${terminal.message}`);
        return;
      }
      setTrace((current) => {
        const next = { ...current };
        for (const stage of rawTraceStages) next[stage] = { status: "pass", duration: next[stage]?.duration ?? Math.max(1, elapsed / rawTraceStages.length) };
        return next;
      });
      setOutcome(terminal.outcome);
      setActionRunId(terminal.runId);
      setActionCapability(terminal.deletionToken);
      setActionDetailStatus("loading");
      cancellableRef.current = false;
      configurationLockedRef.current = false;
      setRunning(false);
      setLiveMessage(`Run complete. Outcome: ${outcomeLabel[terminal.outcome]}.`);
      const streamedFields = fieldAccumulatorRef.current.requestId === requestId ? [...fieldAccumulatorRef.current.fields.values()] : [];
      const completedFields = streamedFields.length ? streamedFields : source === "synthetic" ? fixture.fields : [];
      setFields(completedFields);
      const comparable: ComparableRun = {
        id: terminal.runId,
        providerCalled: terminal.executionMode === "live",
        provider: terminal.executionMode === "live" ? provider : null,
        model: terminal.executionMode === "live" ? (selectedModelDefinition?.displayName ?? selectedModel) : null,
        configuredProvider: provider,
        configuredModel: selectedModel,
        executionMode: terminal.executionMode,
        requestedFields: completedFields.map((field) => field.label),
        values: completedFields.map(comparisonValue),
        evidence: completedFields.map((field) => field.evidence ?? "No evidence found"),
        evaluator: completedFields.map((field) => field.evaluatorStatus),
        latencyMs: Math.round(elapsed),
        outcome: terminal.outcome,
      };
      setHistory((current) => [comparable, ...current.filter((run) => run.id !== comparable.id)]);
      setOutcomeFocusVersion((current) => current + 1);
      await loadPreparedAction(terminal.runId, requestId, controller.signal);
    } catch (reason) {
      if (requestId !== requestRef.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setLiveMessage("Run cancelled. The selected source is still available.");
      } else {
        const message = reason instanceof Error ? reason.message : "The run could not be completed.";
        setTrace((current) => failActiveTrace(current));
        lastStageRef.current = null;
        setError(message);
        setLiveMessage(`Run stopped. ${message}`);
      }
    } finally {
      if (requestId === requestRef.current) {
        cancellableRef.current = false;
        configurationLockedRef.current = false;
        setRunning(false);
        abortRef.current = null;
      }
    }
  }

  function cancelRun() {
    if (!cancellableRef.current) return;
    cancellableRef.current = false;
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    configurationLockedRef.current = false;
    setRunning(false);
    setTrace((current) => Object.fromEntries(
      Object.entries(current).map(([stage, state]) => [
        stage,
        state?.status === "active" ? { ...state, status: "idle" as const } : state,
      ]),
    ));
    lastStageRef.current = null;
    setLiveMessage("Run cancelled. The selected source is still available.");
    requestAnimationFrame(() => runButtonRef.current?.focus());
  }

  async function deleteRun() {
    if (!selectedDeletionReceipt) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(selectedDeletionReceipt.runId)}`, { method: "DELETE", headers: { "x-delete-token": selectedDeletionReceipt.token } });
      if (!response.ok) throw new Error("Deletion could not be confirmed. Retry with the same browser-held token.");
      removeStoredDeletion(selectedDeletionReceipt.runId);
      setHistory((current) => current.filter((run) => run.id !== selectedDeletionReceipt.runId));
      setDeletionReceipts((current) => current.filter((receipt) => receipt.runId !== selectedDeletionReceipt.runId));
      setSelectedDeletionId("");
      setDeleteDialogOpen(false);
      setLiveMessage("Run deleted.");
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Deletion is temporarily unavailable.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main id="main-content" className="page workbench-page">
      <header className="page-intro">
        <div><h1>Review a document</h1><p>Use synthetic samples or a custom file you voluntarily choose to make public for a limited review.</p></div>
        <KeylessNotice />
      </header>
      <LiveRegion message={liveMessage} />
      <form noValidate onSubmit={(event) => { event.preventDefault(); runAssurance(); }}>
        <div className="workbench-desk">
          <RulePanel className="source-rail" title="1. Source">
            <div className="source-list" aria-label="Document source">
              {syntheticFixtures.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  className={`source-tile${source === "synthetic" && sampleId === sample.id ? " selected-control" : ""}`}
                  aria-pressed={source === "synthetic" && sampleId === sample.id}
                  disabled={running}
                  onClick={() => {
                    setSource("synthetic");
                    setSampleId(sample.id);
                    setError("");
                  }}
                >
                  <strong>{sample.title}</strong>
                  <small>{sample.description}</small>
                </button>
              ))}
              <button
                type="button"
                className={`source-tile source-tile--upload${source === "custom" ? " selected-control" : ""}`}
                aria-pressed={source === "custom"}
                disabled={running}
                onClick={() => {
                  setSource("custom");
                  setError("");
                  customUploadRef.current?.openFilePicker();
                }}
              >
                <strong>+ Add your document</strong>
              </button>
            </div>
            <div className="custom-upload-panel" hidden={source !== "custom"}>
              <CustomUploadFields ref={customUploadRef} onReadyChange={setCustom} disabled={running} />
            </div>
          </RulePanel>

          <section className="document-work-area">
            <div className="run-controls">
              <ModelSelector models={models} value={selectedModel} onChange={setSelectedModel} disabled={running} />
              <div className="run-actions">
                {source === "synthetic" ? <span className="demo-mode-label">Demo data — no provider call</span> : null}
                <Button ref={runButtonRef} type="submit" busy={running}>Run assurance check</Button>
                {running ? <Button type="button" intent="ghost" onClick={cancelRun}>Cancel run</Button> : null}
              </div>
            </div>
            {error ? <div className="inline-error recovery-error" role="alert"><strong>Run unavailable</strong><span>{error}</span>{source === "custom" ? <Button type="button" intent="neutral" onClick={() => { setSource("synthetic"); setError(""); }}>Use a synthetic sample</Button> : null}</div> : null}
            <DocumentPreview source={source} selectedFixture={selectedFixture} custom={custom} previewUrl={previewUrl} />
          </section>

          <aside className="assurance-rail">
            <RulePanel title="Assurance trace">
              <ol className="trace-list">{displayTrace.map((stage) => <li key={stage.key} className={stage.status === "active" ? "trace-active" : ""}><StatusMark status={stage.status} /><span><strong>{stage.label}</strong><small>{stage.status === "active" ? "In progress" : stage.status === "pass" ? "Completed" : stage.status === "error" ? "Needs attention" : "Pending"}</small></span><time>{stage.duration === null ? "—" : `${(stage.duration / 1000).toFixed(1)} s`}</time></li>)}</ol>
            </RulePanel>
            {!outcome ? (
              <RulePanel title="Prepared action">
                <EmptyState title="Awaiting a run">A safe action proposal will appear here before its evidence.</EmptyState>
              </RulePanel>
            ) : (
              <>
                <RulePanel title="Prepared action">
                  {preparedAction && actionRunId ? (
                    <ActionCard key={actionRunId} runId={actionRunId} action={preparedAction} capabilityToken={actionCapability} />
                  ) : actionDetailStatus === "loading" ? (
                    <EmptyState title="Loading prepared action">The completed run is loading its safe action proposal.</EmptyState>
                  ) : actionDetailStatus === "error" ? (
                    <div className="inline-error recovery-error" role="alert" aria-label="Prepared action unavailable">
                      <strong>Prepared action unavailable</strong>
                      <span>{actionDetailError}</span>
                      <Button type="button" intent="neutral" onClick={() => void retryPreparedAction()}>Retry prepared action</Button>
                    </div>
                  ) : (
                    <EmptyState title="No action available">The run did not return a safe action proposal.</EmptyState>
                  )}
                </RulePanel>
                <RulePanel title="Evidence ledger">
                  <ResultLedger outcome={outcome} fields={fields.length ? fields : source === "synthetic" ? fixture.fields : []} headingRef={outcomeHeadingRef} />
                </RulePanel>
              </>
            )}
          </aside>
        </div>
      </form>

      <section className="history-band" aria-labelledby="history-heading">
        <header><div><h2 id="history-heading">Public run history</h2><p>Active details remain visible for less than 24 hours.</p></div><span>{history.length} active public runs</span></header>
        {historyLoading ? <p className="history-status" role="status">Loading active public runs…</p> : null}
        {historyError ? <div className="inline-error history-error" role="alert" aria-label="Public run history unavailable">{historyError}</div> : null}
        {!historyLoading && !history.length ? <EmptyState title="No active public runs">Complete two demo runs to compare their evidence and outcomes.</EmptyState> : history.length ? (
          <div className="comparison-controls"><label>Run A<select value={leftId} onChange={(event) => setLeftId(event.target.value)}><option value="">Select run A</option>{history.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}</select></label><label>Run B<select value={rightId} onChange={(event) => setRightId(event.target.value)}><option value="">Select run B</option>{history.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}</select></label></div>
        ) : null}
        <ComparisonLedger runs={history} leftId={leftId} rightId={rightId} />
      </section>

      {deletionReceipts.length ? <section className="deletion-receipts" aria-labelledby="deletion-receipts-title"><h2 id="deletion-receipts-title" className="sr-only">Browser-held deletion receipts</h2>{deletionReceipts.map((receipt) => <aside className="deletion-receipt" key={receipt.runId}><ShieldCheck aria-hidden="true" /><div><h3>Early deletion is available</h3><p>This one-time deletion token is stored only in this browser until expiry. It is never placed in a URL.</p><output className="mono">{receipt.token}</output><small className="mono">Run: {receipt.runId}</small></div><Button type="button" intent="danger" aria-label={`Delete run ${receipt.runId}`} onClick={() => { setSelectedDeletionId(receipt.runId); setDeleteError(""); setDeleteDialogOpen(true); }}>Delete now</Button></aside>)}</section> : null}
      <DangerDialog open={deleteDialogOpen} title="Delete this public run?" description="The raw file and detailed trace will be permanently removed. This action cannot be undone." objectName={selectedDeletionReceipt?.runId ?? ""} busy={deleting} error={deleteError} onCancel={() => { setDeleteDialogOpen(false); setSelectedDeletionId(""); }} onConfirm={deleteRun} />
    </main>
  );
}

function DocumentPreview({
  source,
  selectedFixture,
  custom,
  previewUrl,
}: {
  source: "synthetic" | "custom";
  selectedFixture: (typeof syntheticFixtures)[number];
  custom: CustomUploadState;
  previewUrl: string;
}) {
  if (source === "custom") {
    let preview = <EmptyState title="Choose a local file">The file remains local until consented submission.</EmptyState>;
    if (custom.file?.type.startsWith("image/") && previewUrl) {
      // eslint-disable-next-line @next/next/no-img-element -- object URLs cannot use the Next image optimizer
      preview = <img src={previewUrl} alt={`Local preview of ${custom.file.name}`} />;
    } else if (custom.file?.type.startsWith("image/")) {
      preview = <div className="pdf-fallback"><FileText aria-hidden="true" /><h3>{custom.file.name}</h3><p>Preparing the local image preview…</p></div>;
    } else if (custom.file) {
      preview = <div className="pdf-fallback"><FileText aria-hidden="true" /><h3>{custom.file.name}</h3><p>PDF preview is kept local before consent.</p><a href={previewUrl} target="_blank" rel="noreferrer">Open local PDF</a></div>;
    }
    return <RulePanel className="document-preview" title="Document preview">{preview}</RulePanel>;
  }
  return (
    <RulePanel className="document-preview" title="Document preview" action={<a href={`/samples/${selectedFixture.filename}`} target="_blank" rel="noreferrer">Open fixture PDF</a>}>
      <article className="invoice-sheet" aria-label={`Synthetic document: ${selectedFixture.title}`}>
        <header><div><span className="invoice-kicker">Synthetic document</span><h2>{selectedFixture.title}</h2><p>{selectedFixture.description}</p></div><strong>REVIEW</strong></header>
        <div className="invoice-meta"><dl>{selectedFixture.requestedFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{selectedFixture.documentData[field.key] ?? "Not present"}</dd></div>)}</dl></div>
        <div className="document-instruction"><span>Document instruction</span><strong>{selectedFixture.action.instructionEvidence ?? "No document instruction found"}</strong></div>
        <footer><span>Fixture ID</span><code>{selectedFixture.id}</code></footer>
      </article>
    </RulePanel>
  );
}

function ResultLedger({ outcome, fields, headingRef }: { outcome: Outcome; fields: FieldResult[]; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const custom = outcome === "evidence_consistent" || outcome === "conflict" || outcome === "not_found";
  return <div className="result-ledger"><header><StatusMark status={outcome === "clear" || outcome === "evidence_consistent" ? "pass" : outcome === "incomplete" || outcome === "not_found" ? "warning" : "error"} /><div><h3 ref={headingRef} tabIndex={-1}>{outcomeLabel[outcome]}</h3><p>{custom ? "This label describes document evidence only. It does not approve any business action." : "Guided fixture outcome from demo data."}</p></div></header><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable extracted field ledger"><table><caption className="sr-only">Extracted field evidence ledger</caption><thead><tr><th scope="col">Field</th><th scope="col">Extracted value</th><th scope="col">Evidence snippet</th><th scope="col">Page</th><th scope="col">Evaluator status</th><th scope="col">Reference match</th></tr></thead><tbody>{fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th><td>{field.extractedValue ?? "Not found"}</td><td className="evidence-cell">{field.evidence ?? "No evidence found"}</td><td>{field.page ?? "—"}</td><td>{field.evaluatorStatus.replaceAll("_", " ")}</td><td>{field.referenceMatch === null ? "Not applicable" : field.referenceMatch ? "Match" : "Mismatch"}</td></tr>)}</tbody></table></div></div>;
}
