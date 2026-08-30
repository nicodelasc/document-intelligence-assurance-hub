"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ShieldCheck } from "lucide-react";
import type {
  ActionProposal,
  DocumentClassification,
  DocumentFamily,
  FieldResult,
  Outcome,
  Provider,
  RunEvent,
  RunStatus,
  WorkflowEvent,
} from "@/domain/types";
import {
  recordedDocumentRunResults,
  syntheticFixtures,
} from "@/domain/fixtures";
import { liveModelCatalog } from "@/domain/live-model-catalog";
import { actionProposalSchema, workflowEventSchema } from "@/domain/run-schema";
import { Button, EmptyState, LiveRegion, ProcessingStatus, RulePanel, StatusMark } from "@/components/ui/primitives";
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
import { ActivityTimeline } from "./activity-timeline";
import { WorkflowPanel } from "./workflow-panel";
import type { ProviderAvailability } from "@/server/http/container";
import { DocumentPreview } from "./document-preview";
import { FixtureLibrary } from "./fixture-library";
import { AssuranceTrace } from "./assurance-trace";
import { workbenchTourTargetIds } from "./guided-tour-config";

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
type ProviderAttribution = Pick<ComparableRun, "providerCalled" | "provider" | "model">;
type RunSubmissionSnapshot = {
  source: "synthetic" | "custom";
  sampleId: string;
  provider: Provider;
  model: string;
  executionMode: "recorded" | "live";
  documentFamily: DocumentFamily | null;
  customFile: File | null;
  customFields: readonly string[];
  customConsent: boolean;
};
type PublicRunHydration = {
  status: RunStatus | null;
  outcome: Outcome | null;
  documentFamily: DocumentFamily | null;
  documentFamilyPresent: boolean;
  documentClassification: DocumentClassification | null;
  proposal: ActionProposal | null;
  workflowEvents: WorkflowEvent[];
  fields: FieldResult[];
  safeDiagnosticCodes: string[];
  attribution: ProviderAttribution | null;
};
type ModelConfiguration = {
  models: readonly ModelOption[];
  selectedModel: string;
  providerAvailability: ProviderAvailability;
};
type ModelAvailabilityStatus = "loading" | "resolved" | "failed";

const outcomes = new Set<Outcome>(["clear", "needs_review", "incomplete", "evidence_consistent", "conflict", "not_found"]);
const documentClassifications = new Set<DocumentClassification>([
  "supplier_invoice",
  "warehouse_goods_receipt",
  "irrelevant",
  "uncertain",
]);
const guardedDocumentBrief =
  "This does not appear to be a supported supplier invoice or warehouse goods receipt. No workflow action was prepared.";

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

function providerAttributionFromPublicPayload(payload: unknown): ProviderAttribution | null {
  if (!payload || typeof payload !== "object") return null;
  const run = (payload as { run?: unknown }).run;
  if (!run || typeof run !== "object") return null;
  const record = run as Record<string, unknown>;
  if (typeof record.providerCalled !== "boolean") return null;
  if (record.providerCalled) {
    if (!isProvider(record.provider) || typeof record.model !== "string") return null;
    return {
      providerCalled: true,
      provider: record.provider,
      model: record.model,
    };
  }
  if (record.provider !== null || record.model !== null) return null;
  return { providerCalled: false, provider: null, model: null };
}

const runStatuses = new Set<RunStatus>([
  "validating",
  "storing",
  "extracting",
  "verifying",
  "comparing",
  "deciding",
  "publishing",
  "completed",
  "failed",
  "expired",
  "deleted",
]);

function fieldFromUnknown(candidate: unknown): FieldResult | null {
  if (!candidate || typeof candidate !== "object") return null;
  const field = candidate as Record<string, unknown>;
  if (
    typeof field.key !== "string" ||
    typeof field.label !== "string" ||
    (field.extractedValue !== null && typeof field.extractedValue !== "string") ||
    (field.normalizedValue !== null && typeof field.normalizedValue !== "string") ||
    (field.evidence !== null && typeof field.evidence !== "string") ||
    (field.page !== null && typeof field.page !== "number") ||
    (field.evaluatorStatus !== "pass" &&
      field.evaluatorStatus !== "conflict" &&
      field.evaluatorStatus !== "not_found") ||
    (field.referenceMatch !== null && typeof field.referenceMatch !== "boolean")
  ) {
    return null;
  }
  return field as unknown as FieldResult;
}

function publicRunHydration(payload: unknown): PublicRunHydration | null {
  if (!payload || typeof payload !== "object") return null;
  const run = (payload as { run?: unknown }).run;
  if (!run || typeof run !== "object") return null;
  const record = run as Record<string, unknown>;
  const details =
    record.details && typeof record.details === "object"
      ? (record.details as Record<string, unknown>)
      : null;
  const result =
    details?.result && typeof details.result === "object"
      ? (details.result as Record<string, unknown>)
      : null;
  const parsedAction = result?.action
    ? actionProposalSchema.safeParse(result.action)
    : null;
  const workflowEvents = Array.isArray(details?.workflowEvents)
    ? details.workflowEvents.flatMap((event) => {
        const parsed = workflowEventSchema.safeParse(event);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const fields = Array.isArray(result?.fields)
    ? result.fields.flatMap((field) => {
        const parsed = fieldFromUnknown(field);
        return parsed ? [parsed] : [];
      })
    : [];
  const safeDiagnosticCodes = Array.isArray(details?.steps)
    ? details.steps.flatMap((step) => {
        if (!step || typeof step !== "object") return [];
        const safeCode = (step as { safeCode?: unknown }).safeCode;
        return typeof safeCode === "string" && safeCode.trim()
          ? [safeCode.trim().slice(0, 80)]
          : [];
      })
    : [];
  const status =
    typeof record.status === "string" && runStatuses.has(record.status as RunStatus)
      ? (record.status as RunStatus)
      : null;
  const outcome =
    typeof record.outcome === "string" && outcomes.has(record.outcome as Outcome)
      ? (record.outcome as Outcome)
      : null;
  const documentFamily =
    record.documentFamily === "supplier_invoice" ||
    record.documentFamily === "warehouse_goods_receipt"
      ? record.documentFamily
      : null;
  const documentClassification =
    typeof result?.documentClassification === "string" &&
    documentClassifications.has(result.documentClassification as DocumentClassification)
      ? (result.documentClassification as DocumentClassification)
      : null;
  return {
    status,
    outcome,
    documentFamily,
    documentFamilyPresent:
      record.documentFamily === null || documentFamily !== null,
    documentClassification,
    proposal: parsedAction?.success ? parsedAction.data : null,
    workflowEvents,
    fields,
    safeDiagnosticCodes: [...new Set(safeDiagnosticCodes)],
    attribution: providerAttributionFromPublicPayload(payload),
  };
}

function sortWorkflowEvents(events: readonly WorkflowEvent[]): WorkflowEvent[] {
  return [...events].sort((left, right) => {
    const timestampOrder = left.createdAt.localeCompare(right.createdAt);
    return timestampOrder === 0
      ? left.id.localeCompare(right.id)
      : timestampOrder;
  });
}

function mergeWorkflowEvents(
  current: readonly WorkflowEvent[],
  incoming: readonly WorkflowEvent[],
): WorkflowEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return sortWorkflowEvents([...byId.values()]);
}

function modelConfigurationFromPayload(payload: unknown): ModelConfiguration | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    models?: unknown;
    defaults?: Partial<Record<Provider, string>>;
    providerAvailability?: Partial<ProviderAvailability>;
  };
  if (!Array.isArray(record.models)) return null;
  const approvedModels = record.models.filter(
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
  if (!approvedModels.length) return null;
  if (
    typeof record.providerAvailability?.openai !== "boolean" ||
    typeof record.providerAvailability.anthropic !== "boolean"
  ) {
    return null;
  }
  const serverDefault = record.defaults?.openai;
  return {
    models: approvedModels,
    selectedModel: approvedModels.some((model) => model.id === serverDefault)
      ? serverDefault!
      : approvedModels[0].id,
    providerAvailability: {
      openai: record.providerAvailability.openai,
      anthropic: record.providerAvailability.anthropic,
    },
  };
}

export function WorkbenchView() {
  const [source, setSource] = useState<"synthetic" | "custom">("synthetic");
  const [sampleId, setSampleId] = useState<(typeof syntheticFixtures)[number]["id"]>(syntheticFixtures[0].id);
  const [models, setModels] = useState<readonly ModelOption[]>(liveModelCatalog);
  const [selectedModel, setSelectedModel] = useState<string>(liveModelCatalog[0].id);
  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>({
    openai: false,
    anthropic: false,
  });
  const [modelAvailabilityStatus, setModelAvailabilityStatus] =
    useState<ModelAvailabilityStatus>("loading");
  const [custom, setCustom] = useState<CustomUploadState>({ file: null, fields: ["", ""], consent: false, valid: false });
  const [previewUrl, setPreviewUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceState>(freshTrace);
  const [traceExpanded, setTraceExpanded] = useState(true);
  const [traceElapsedMs, setTraceElapsedMs] = useState<number | null>(null);
  const [traceTerminalStatus, setTraceTerminalStatus] =
    useState<Extract<RunStatus, "completed" | "failed"> | null>(null);
  const [fields, setFields] = useState<FieldResult[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preparedAction, setPreparedAction] = useState<ActionProposal | null>(null);
  const [actionRunId, setActionRunId] = useState("");
  const [actionCapability, setActionCapability] = useState("");
  const [activeRunStatus, setActiveRunStatus] = useState<RunStatus | null>(null);
  const [activeRunFamily, setActiveRunFamily] =
    useState<DocumentFamily | null>(null);
  const [documentClassification, setDocumentClassification] =
    useState<DocumentClassification | null>(null);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [safeDiagnosticCodes, setSafeDiagnosticCodes] = useState<string[]>([]);
  const [actionDetailStatus, setActionDetailStatus] = useState<ActionDetailStatus>("idle");
  const [actionDetailError, setActionDetailError] = useState("");
  const [error, setError] = useState("");
  const [workflowNotice, setWorkflowNotice] = useState("");
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
  const detailAbortRef = useRef<AbortController | null>(null);
  const cancellableRef = useRef(false);
  const configurationLockedRef = useRef(false);
  const pendingModelConfigurationRef = useRef<ModelConfiguration | null>(null);
  const requestRef = useRef(0);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const outcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const customUploadRef = useRef<CustomUploadHandle>(null);
  const startedRef = useRef(0);
  const lastStageRef = useRef<{ key: RunStatus; at: number } | null>(null);
  const lastAnnouncedDisplayStageRef = useRef<DisplayTraceKey | null>(null);
  const fieldAccumulatorRef = useRef<{ requestId: number; fields: Map<string, FieldResult> }>({ requestId: 0, fields: new Map() });
  const activeRunSnapshotRef = useRef<RunSubmissionSnapshot | null>(null);
  const selectedDeletionReceipt = deletionReceipts.find((receipt) => receipt.runId === selectedDeletionId) ?? null;

  const applyModelConfiguration = useCallback((configuration: ModelConfiguration) => {
    setModels(configuration.models);
    setSelectedModel(configuration.selectedModel);
    setProviderAvailability(configuration.providerAvailability);
    setModelAvailabilityStatus("resolved");
  }, []);

  const unlockConfiguration = useCallback(() => {
    configurationLockedRef.current = false;
    const pending = pendingModelConfigurationRef.current;
    if (!pending) return;
    pendingModelConfigurationRef.current = null;
    applyModelConfiguration(pending);
  }, [applyModelConfiguration]);

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
        if (!response.ok) throw new Error("model_configuration_unavailable");
        const configuration = modelConfigurationFromPayload(await response.json());
        if (!configuration) throw new Error("model_configuration_invalid");
        if (controller.signal.aborted) return;
        if (configurationLockedRef.current) {
          pendingModelConfigurationRef.current = configuration;
          return;
        }
        applyModelConfiguration(configuration);
      } catch {
        if (!controller.signal.aborted) setModelAvailabilityStatus("failed");
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
  }, [applyModelConfiguration]);

  useEffect(() => () => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
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

  const selectedFixture =
    syntheticFixtures.find((candidate) => candidate.id === sampleId) ??
    syntheticFixtures[0];
  const selectedModelDefinition =
    models.find((model) => model.id === selectedModel) ?? models[0];
  const provider: Provider = selectedModelDefinition?.provider ?? "openai";
  const displayTrace = buildDisplayTrace(trace);
  const hasTerminalRun = Boolean(actionRunId) &&
    (activeRunStatus === "completed" || activeRunStatus === "failed");
  const guardedDocument =
    documentClassification === "irrelevant" ||
    documentClassification === "uncertain";

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

  async function loadRunDetail(
    runId: string,
    requestId: number,
    signal: AbortSignal,
  ): Promise<ProviderAttribution | null> {
    setActionDetailStatus("loading");
    setActionDetailError("");
    try {
      const detailResponse = await fetch(
        `/api/runs/${encodeURIComponent(runId)}`,
        { signal },
      );
      if (!detailResponse.ok) throw new Error("action_detail_unavailable");
      const payload = await detailResponse.json();
      const hydration = publicRunHydration(payload);
      if (!hydration) throw new Error("action_detail_unavailable");
      if (requestId !== requestRef.current) return null;
      if (hydration.status) setActiveRunStatus(hydration.status);
      if (hydration.outcome) setOutcome(hydration.outcome);
      if (hydration.documentFamilyPresent) {
        setActiveRunFamily(hydration.documentFamily);
      }
      setDocumentClassification(hydration.documentClassification);
      setPreparedAction(hydration.proposal);
      setWorkflowEvents((current) =>
        mergeWorkflowEvents(current, hydration.workflowEvents),
      );
      if (hydration.fields.length) setFields(hydration.fields);
      setSafeDiagnosticCodes((current) => [
        ...new Set([...current, ...hydration.safeDiagnosticCodes]),
      ]);
      setActionDetailStatus("ready");
      return hydration.attribution;
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      if (requestId !== requestRef.current) return null;
      setPreparedAction(null);
      setActionDetailStatus("error");
      setActionDetailError("The prepared action is temporarily unavailable.");
      return null;
    }
  }

  async function retryPreparedAction() {
    if (!actionRunId || actionDetailStatus === "loading") return;
    const controller = new AbortController();
    const requestId = requestRef.current;
    try {
      detailAbortRef.current?.abort();
      detailAbortRef.current = controller;
      await loadRunDetail(actionRunId, requestId, controller.signal);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setActionDetailStatus("error");
        setActionDetailError("The prepared action is temporarily unavailable.");
      }
    } finally {
      if (detailAbortRef.current === controller) detailAbortRef.current = null;
    }
  }

  function captureRunSnapshot(): RunSubmissionSnapshot {
    const providerAvailable = providerAvailability[provider];
    return {
      source,
      sampleId,
      provider,
      model: selectedModel,
      executionMode: providerAvailable ? "live" : "recorded",
      documentFamily: source === "synthetic" ? selectedFixture.family : null,
      customFile: source === "custom" ? custom.file : null,
      customFields: [...custom.fields],
      customConsent: custom.consent,
    };
  }

  function clearActiveWorkflow() {
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    activeRunSnapshotRef.current = null;
    setOutcome(null);
    setPreparedAction(null);
    setActionRunId("");
    setActionCapability("");
    setActiveRunStatus(null);
    setActiveRunFamily(null);
    setDocumentClassification(null);
    setWorkflowEvents([]);
    setSafeDiagnosticCodes([]);
    setActionDetailStatus("idle");
    setActionDetailError("");
  }

  function appendWorkflowEvent(event: WorkflowEvent) {
    setWorkflowEvents((current) =>
      sortWorkflowEvents([
        ...current.filter((candidate) => candidate.id !== event.id),
        event,
      ]),
    );
  }

  function requestReplacement(message?: string) {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearActiveWorkflow();
    setTrace(freshTrace());
    setTraceExpanded(true);
    setTraceElapsedMs(null);
    setTraceTerminalStatus(null);
    setSource("custom");
    setError("");
    setWorkflowNotice(
      message ??
        "Choose a replacement document then confirm consent and process it through the normal review path.",
    );
    customUploadRef.current?.requestReplacement();
  }

  async function reprocessActiveRun() {
    const snapshot = activeRunSnapshotRef.current;
    if (!snapshot) return;
    if (
      snapshot.source === "custom" &&
      (!snapshot.customFile || custom.file !== snapshot.customFile)
    ) {
      requestReplacement(
        "The original file is no longer held by this browser. Choose a replacement then confirm consent before processing.",
      );
      return;
    }
    await runAssurance(snapshot);
  }

  async function runAssurance(snapshotOverride?: RunSubmissionSnapshot) {
    if (running || cancellableRef.current) return;
    if (modelAvailabilityStatus !== "resolved") {
      setError("Processing availability has not been confirmed.");
      return;
    }
    const snapshot = snapshotOverride ?? captureRunSnapshot();
    if (snapshot.source === "custom" && snapshot.executionMode !== "live") {
      setError("Processing unavailable for this model");
      return;
    }
    cancellableRef.current = true;
    configurationLockedRef.current = true;
    setRunning(true);
    abortRef.current?.abort();
    abortRef.current = null;
    const requestId = ++requestRef.current;
    if (snapshot.source === "custom" && snapshotOverride === undefined) {
      const customValid = await customUploadRef.current?.validate();
      if (requestId !== requestRef.current) return;
      if (!customValid) {
        setError("Complete the document, field labels and consent before running a custom check.");
        cancellableRef.current = false;
        unlockConfiguration();
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
    setWorkflowNotice("");
    setTraceExpanded(true);
    setTraceElapsedMs(null);
    setTraceTerminalStatus(null);
    clearActiveWorkflow();
    activeRunSnapshotRef.current = snapshot;
    setFields([]);
    setTrace(freshTrace());
    setLiveMessage("Assurance run started.");
    const form = new FormData();
    form.set("sourceType", snapshot.source);
    form.set("provider", snapshot.provider);
    form.set("model", snapshot.model);
    form.set("executionMode", snapshot.executionMode);
    if (snapshot.source === "synthetic") form.set("sampleId", snapshot.sampleId);
    else if (snapshot.customFile) {
      form.set("document", snapshot.customFile);
      snapshot.customFields.forEach((field) => form.append("requestedField", field));
      form.set("consent", String(snapshot.customConsent));
    }
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        body: form,
        headers: {
          "Idempotency-Key": crypto.randomUUID(),
          "X-Run-Source-Type": snapshot.source,
          "X-Run-Execution-Mode": snapshot.executionMode,
        },
        signal: controller.signal,
      });
      const terminal = await consumeNdjson(response, { onEvent: (event) => onStreamEvent(event, requestId) });
      if (requestId !== requestRef.current) return;
      const elapsed = performance.now() - startedRef.current;
      if (snapshot.source === "custom" && terminal.runId && terminal.deletionToken) {
        rememberDeletionReceipt(terminal.runId, terminal.deletionToken);
      }
      if (terminal.type === "failed") {
        cancellableRef.current = false;
        unlockConfiguration();
        setRunning(false);
        setTrace((current) => failActiveTrace(current));
        setTraceExpanded(true);
        setTraceTerminalStatus("failed");
        lastStageRef.current = null;
        setError(terminal.message);
        setLiveMessage(`Run stopped. ${terminal.message}`);
        setSafeDiagnosticCodes([terminal.code]);
        if (terminal.runId && terminal.deletionToken) {
          setActionRunId(terminal.runId);
          setActionCapability(terminal.deletionToken);
          setActiveRunStatus("failed");
          setActiveRunFamily(snapshot.documentFamily);
          setActionDetailStatus("loading");
          setOutcomeFocusVersion((current) => current + 1);
          const detailController = new AbortController();
          detailAbortRef.current?.abort();
          detailAbortRef.current = detailController;
          await loadRunDetail(
            terminal.runId,
            requestId,
            detailController.signal,
          );
          if (detailAbortRef.current === detailController) {
            detailAbortRef.current = null;
          }
        }
        return;
      }
      setTrace((current) => {
        const next = { ...current };
        for (const stage of rawTraceStages) next[stage] = { status: "pass", duration: next[stage]?.duration ?? Math.max(1, elapsed / rawTraceStages.length) };
        return next;
      });
      setTraceElapsedMs(elapsed);
      setTraceExpanded(false);
      setTraceTerminalStatus("completed");
      setOutcome(terminal.outcome);
      setActionRunId(terminal.runId);
      setActionCapability(terminal.deletionToken);
      setActiveRunStatus("completed");
      setActiveRunFamily(snapshot.documentFamily);
      setActionDetailStatus("loading");
      cancellableRef.current = false;
      unlockConfiguration();
      setRunning(false);
      setLiveMessage(`Run complete. Outcome: ${outcomeLabel[terminal.outcome]}.`);
      const streamedFields = fieldAccumulatorRef.current.requestId === requestId ? [...fieldAccumulatorRef.current.fields.values()] : [];
      const recordedFixture = recordedDocumentRunResults.find(
        (candidate) => candidate.fixtureId === snapshot.sampleId,
      );
      const completedFields = streamedFields.length
        ? streamedFields
        : snapshot.source === "synthetic"
          ? (recordedFixture?.fields ?? [])
          : [];
      setFields(completedFields);
      setOutcomeFocusVersion((current) => current + 1);
      const detailController = new AbortController();
      detailAbortRef.current?.abort();
      detailAbortRef.current = detailController;
      const attribution = await loadRunDetail(
        terminal.runId,
        requestId,
        detailController.signal,
      );
      if (detailAbortRef.current === detailController) {
        detailAbortRef.current = null;
      }
      if (attribution) {
        const comparable: ComparableRun = {
          id: terminal.runId,
          ...attribution,
          configuredProvider: snapshot.provider,
          configuredModel: snapshot.model,
          executionMode: terminal.executionMode,
          requestedFields: completedFields.map((field) => field.label),
          values: completedFields.map(comparisonValue),
          evidence: completedFields.map((field) => field.evidence ?? "No evidence found"),
          evaluator: completedFields.map((field) => field.evaluatorStatus),
          latencyMs: Math.round(elapsed),
          outcome: terminal.outcome,
        };
        setHistory((current) => [comparable, ...current.filter((run) => run.id !== comparable.id)]);
      }
    } catch (reason) {
      if (requestId !== requestRef.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setLiveMessage("Run cancelled. The selected source is still available.");
      } else {
        const message = reason instanceof Error ? reason.message : "The run could not be completed.";
        activeRunSnapshotRef.current = null;
        setTrace((current) => failActiveTrace(current));
        setTraceExpanded(true);
        setTraceTerminalStatus("failed");
        lastStageRef.current = null;
        setError(message);
        setLiveMessage(`Run stopped. ${message}`);
      }
    } finally {
      if (requestId === requestRef.current) {
        cancellableRef.current = false;
        unlockConfiguration();
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
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    clearActiveWorkflow();
    unlockConfiguration();
    setRunning(false);
    setTrace((current) => Object.fromEntries(
      Object.entries(current).map(([stage, state]) => [
        stage,
        state?.status === "active" ? { ...state, status: "idle" as const } : state,
      ]),
    ));
    setTraceExpanded(true);
    setTraceElapsedMs(null);
    setTraceTerminalStatus(null);
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
      </header>
      <LiveRegion message={liveMessage} />
      <form noValidate onSubmit={(event) => { event.preventDefault(); runAssurance(); }}>
        <div className="workbench-desk">
          <RulePanel
            className="source-rail"
            headerId={workbenchTourTargetIds.documentLibrary}
            headerClassName="tour-target"
            title="1. Document library"
          >
            <FixtureLibrary
              fixtures={syntheticFixtures}
              selectedId={source === "synthetic" ? sampleId : ""}
              disabled={running}
              onSelect={(fixtureId) => {
                setSource("synthetic");
                setSampleId(fixtureId);
                setError("");
              }}
              onUpload={() => {
                setSource("custom");
                setError("");
                customUploadRef.current?.openFilePicker();
              }}
            />
            <div className="custom-upload-panel" hidden={source !== "custom"}>
              <CustomUploadFields ref={customUploadRef} onReadyChange={setCustom} disabled={running} />
            </div>
          </RulePanel>

          <section className="document-work-area">
            <div className="run-controls">
              <div id={workbenchTourTargetIds.processingModel} className="tour-target">
                <ModelSelector models={models} value={selectedModel} onChange={setSelectedModel} disabled={running} />
              </div>
              <div id={workbenchTourTargetIds.processDocument} className="run-actions tour-target">
                <ProcessingStatus
                  available={providerAvailability[provider]}
                  availabilityStatus={modelAvailabilityStatus}
                  source={source}
                />
                <Button
                  ref={runButtonRef}
                  type="submit"
                  busy={running}
                  disabled={
                    modelAvailabilityStatus !== "resolved" ||
                    (source === "custom" && !providerAvailability[provider])
                  }
                >
                  Process document
                </Button>
                {running ? <Button type="button" intent="ghost" onClick={cancelRun}>Cancel run</Button> : null}
              </div>
            </div>
            {error ? <div className="inline-error recovery-error" role="alert"><strong>Run unavailable</strong><span>{error}</span>{source === "custom" ? <Button type="button" intent="neutral" onClick={() => { setSource("synthetic"); setError(""); }}>Use a synthetic sample</Button> : null}</div> : null}
            {workflowNotice ? <p className="inline-guidance" role="status">{workflowNotice}</p> : null}
            <DocumentPreview source={source} fixture={selectedFixture} custom={custom} previewUrl={previewUrl} />
          </section>

          <aside className="assurance-rail">
            <RulePanel id={workbenchTourTargetIds.assuranceTrace} className="tour-target" title="Assurance trace">
              <AssuranceTrace
                displayTrace={displayTrace}
                terminalStatus={traceTerminalStatus}
                elapsedMs={traceElapsedMs}
                expanded={traceExpanded}
                onExpandedChange={setTraceExpanded}
              />
            </RulePanel>
            <div id={workbenchTourTargetIds.decision} className="tour-target">
              {!hasTerminalRun ? (
                <RulePanel title="Business outcome">
                  <EmptyState title="Awaiting a run">A business-facing outcome will appear here before its evidence.</EmptyState>
                </RulePanel>
              ) : (
                <RulePanel title="Decision and next steps" className="decision-panel">
                  <section className="decision-panel__section">
                    <OutcomeSummary
                      status={activeRunStatus!}
                      outcome={outcome}
                      headingRef={outcomeHeadingRef}
                    />
                  </section>
                  <section className="decision-panel__section">
                    <DecisionBrief
                      status={activeRunStatus!}
                      actionDetailStatus={actionDetailStatus}
                      proposal={guardedDocument ? null : preparedAction}
                      documentClassification={documentClassification}
                    />
                  </section>
                  <section className="decision-panel__section">
                    <h3>Evidence differences</h3>
                    <DifferenceSummary status={activeRunStatus!} fields={fields} />
                  </section>
                  <section className="decision-panel__section">
                    <h3>Workflow controls</h3>
                    {actionDetailStatus === "loading" ? (
                      <p className="workflow-detail-status" role="status">Loading prepared workflow details…</p>
                    ) : null}
                    {actionDetailStatus === "error" && activeRunStatus !== "failed" ? (
                      <div className="inline-error recovery-error" role="alert" aria-label="Prepared action unavailable">
                        <strong>Prepared action unavailable</strong>
                        <span>{actionDetailError}</span>
                        <Button type="button" intent="neutral" onClick={() => void retryPreparedAction()}>Retry prepared action</Button>
                      </div>
                    ) : null}
                    <WorkflowPanel
                      key={actionRunId}
                      runId={actionRunId}
                      status={activeRunStatus!}
                      outcome={outcome}
                      proposal={guardedDocument ? null : preparedAction}
                      events={workflowEvents}
                      capabilityToken={actionCapability}
                      documentFamily={activeRunFamily}
                      documentClassification={documentClassification}
                      controlsAvailable={
                        actionDetailStatus !== "loading" &&
                        (activeRunStatus === "failed" ||
                          documentClassification !== null)
                      }
                      fields={fields}
                      safeDiagnosticCodes={safeDiagnosticCodes}
                      onEvent={appendWorkflowEvent}
                      onReprocess={reprocessActiveRun}
                      onRequestReplacement={() => requestReplacement()}
                    />
                  </section>
                </RulePanel>
              )}
            </div>
            {hasTerminalRun ? (
              <>
                <RulePanel title="Evidence ledger">
                  <EvidenceLedger fields={fields} />
                </RulePanel>
                <RulePanel title="Activity timeline">
                  <ActivityTimeline events={workflowEvents} />
                </RulePanel>
              </>
            ) : null}
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

function OutcomeSummary({
  status,
  outcome,
  headingRef,
}: {
  status: RunStatus;
  outcome: Outcome | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  if (status === "failed") {
    return (
      <div className="result-ledger">
        <header>
          <StatusMark status="error" />
          <div>
            <h3 ref={headingRef} tabIndex={-1}>Processing failed</h3>
            <p>The document was not approved or advanced. Use only the safe recovery controls below.</p>
          </div>
        </header>
      </div>
    );
  }
  if (outcome === null) {
    return <EmptyState title="Outcome unavailable">The completed run did not expose a valid business outcome.</EmptyState>;
  }
  const custom = outcome === "evidence_consistent" || outcome === "conflict" || outcome === "not_found";
  const heading =
    outcome === "not_found"
      ? "Incomplete evidence - one or more requested fields were not found"
      : outcomeLabel[outcome];
  return (
    <div className="result-ledger">
      <header>
        <StatusMark status={outcome === "clear" || outcome === "evidence_consistent" ? "pass" : outcome === "incomplete" || outcome === "not_found" ? "warning" : "error"} />
        <div>
          <h3 ref={headingRef} tabIndex={-1}>{heading}</h3>
          <p>{custom ? "This label describes document evidence only. It does not approve any business action." : "Guided fixture outcome from demo data."}</p>
        </div>
      </header>
    </div>
  );
}

function DecisionBrief({
  status,
  actionDetailStatus,
  proposal,
  documentClassification,
}: {
  status: RunStatus;
  actionDetailStatus: ActionDetailStatus;
  proposal: ActionProposal | null;
  documentClassification: DocumentClassification | null;
}) {
  const guarded =
    documentClassification === "irrelevant" ||
    documentClassification === "uncertain";
  if (guarded) {
    return (
      <div className="decision-brief">
        <h3>Decision brief</h3>
        <p>{guardedDocumentBrief}</p>
      </div>
    );
  }
  if (status === "failed") {
    if (actionDetailStatus === "error") {
      return (
        <div className="decision-brief">
          <h3>Decision brief</h3>
          <p>Processing failed and the run detail could not be loaded. No decision brief is available.</p>
        </div>
      );
    }
    if (actionDetailStatus !== "loading") {
      return (
        <div className="decision-brief">
          <h3>Decision brief</h3>
          <p>Processing failed before a decision brief could be prepared. Use only the safe recovery controls below.</p>
        </div>
      );
    }
  }
  return (
    <div className="decision-brief">
      <h3>Decision brief</h3>
      <p>{proposal?.summary ?? "The prepared decision brief is unavailable while the run detail is loading."}</p>
    </div>
  );
}

function DifferenceSummary({
  status,
  fields,
}: {
  status: RunStatus;
  fields: readonly FieldResult[];
}) {
  if (status === "failed") {
    return <p className="difference-empty">No verified differences are available because processing stopped.</p>;
  }
  const differences = fields.filter(
    (field) => field.evaluatorStatus !== "pass" || field.referenceMatch === false,
  );
  if (!differences.length) {
    return <p className="difference-empty">No evidence differences were recorded.</p>;
  }
  return (
    <ul className="result-difference-list">
      {differences.map((field) => (
        <li key={field.key}>
          <strong>{field.label}</strong>
          <span>
            {field.evaluatorStatus === "not_found"
              ? "Required evidence was not found."
              : `Document evidence ${field.extractedValue ?? "Not found"} does not match the reference.`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EvidenceLedger({ fields }: { fields: readonly FieldResult[] }) {
  if (!fields.length) {
    return <EmptyState title="No verified field evidence">Processing did not return a field ledger for this run.</EmptyState>;
  }
  return <div className="result-ledger"><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable extracted field ledger"><table><caption className="sr-only">Extracted field evidence ledger</caption><thead><tr><th scope="col">Field</th><th scope="col">Extracted value</th><th scope="col">Evidence snippet</th><th scope="col">Page</th><th scope="col">Evaluator status</th><th scope="col">Reference match</th></tr></thead><tbody>{fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th><td>{field.extractedValue ?? "Not found"}</td><td className="evidence-cell">{field.evidence ?? "No evidence found"}</td><td>{field.page ?? "—"}</td><td>{field.evaluatorStatus.replaceAll("_", " ")}</td><td>{field.referenceMatch === null ? "Not applicable" : field.referenceMatch ? "Match" : "Mismatch"}</td></tr>)}</tbody></table></div></div>;
}
