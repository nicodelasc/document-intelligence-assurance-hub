/* eslint-disable @next/next/no-img-element -- static previews retain a direct PDF link */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, sourceOriginLabel, StatusMark } from "@/components/ui/primitives";
import { syntheticFixtures } from "@/domain/fixtures";
import type {
  ActionProposal,
  DocumentFamily,
  FieldResult,
  Outcome,
  Provider,
  RunStatus,
  SourceOriginStatus,
  WorkflowActionType,
  WorkflowEvent,
  WorkflowEventStatus,
} from "@/domain/types";
import { operationsTourTargetIds } from "./guided-tour-config";

export const workflowActionLabels: Readonly<Record<WorkflowActionType, string>> = {
  approve_and_stage: "Posting handoff prepared",
  mark_for_later_review: "Marked for later review",
  assign_review: "Exception review assigned",
  request_clarification: "Clarification request prepared",
  request_clearer_document: "Clearer document requested",
  prepare_email: "Email copy prepared - not sent",
  replace_document: "Document replacement prepared",
  retry_processing: "Processing retry prepared",
  download_summary: "Review summary downloaded",
};

type LatestWorkflowEvent = {
  action: WorkflowActionType;
  status: WorkflowEventStatus;
  timestamp: string;
};

export type ExplorerRun = {
  id: string;
  providerCalled: boolean;
  provider: Provider | null;
  model: string | null;
  configuredProvider: Provider;
  configuredModel: string;
  executionMode: "recorded" | "live";
  sourceType: "synthetic" | "custom";
  sourceOriginStatus: SourceOriginStatus;
  documentFamily?: DocumentFamily | null;
  fixtureId?: string | null;
  status: RunStatus;
  outcome: Outcome | null;
  createdAt: string;
  completedAt?: string | null;
  expiresAt: string;
  deletedAt: string | null;
  retryCount: number;
  latencyMs: number | null;
  estimatedCostUsd: number;
  filename?: string;
  latestWorkflowEvent?: LatestWorkflowEvent | null;
};

type DetailStep = {
  kind: string;
  stage: string;
  timestamp: string;
  durationMs: number | null;
  safeCode?: string;
};

type PublicRunDetail = ExplorerRun & {
  promptVersion: string;
  file: { filename: string; mediaType: string; sizeBytes: number; pageCount: number | null };
  requestedFields: Array<{ key: string; label: string }>;
  usage: { inputTokens: number; outputTokens: number };
  stepDurations: Record<string, number>;
  documentUrl: string;
  details?: {
    steps: DetailStep[];
    workflowEvents?: WorkflowEvent[];
    result: null | {
      fields: FieldResult[];
      outcome: Outcome;
      documentInstruction?: string | null;
      action?: ActionProposal;
      estimatedCostUsd: number;
      retryCount: number;
      latencyMs: number;
    };
  };
};

const outcomeOptions: Array<{ value: Outcome; label: string }> = [
  { value: "clear", label: "Clear" },
  { value: "needs_review", label: "Needs review" },
  { value: "incomplete", label: "Incomplete" },
  { value: "evidence_consistent", label: "Evidence-consistent" },
  { value: "conflict", label: "Conflict" },
  { value: "not_found", label: "Not found" },
];
const outcomes = new Set(outcomeOptions.map((option) => option.value));
const fixtureById = new Map(syntheticFixtures.map((fixture) => [fixture.id, fixture]));
const milliseconds = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });

function formatMilliseconds(value: number | null): string {
  return value === null ? "—" : `${milliseconds.format(value)} ms`;
}

function processingDisplay(providerCalled: boolean, value: string | null): string {
  return providerCalled ? (value ?? "Unavailable") : "No AI processing";
}

function formatSingaporeTime(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
    timeZoneName: "short",
  }).format(new Date(value));
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const rawProvider = params.get("provider");
  const rawOutcome = params.get("outcome");
  return {
    provider: rawProvider === "openai" || rawProvider === "anthropic" ? rawProvider : "all",
    outcome: rawOutcome && outcomes.has(rawOutcome as Outcome) ? rawOutcome : "all",
    query: params.get("q") ?? "",
    selected: params.get("run") ?? "",
    page: Math.max(1, Number(params.get("page") ?? "1") || 1),
  };
}

function writeUrl(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.pushState({}, "", url);
}

function reviewDecision(run: ExplorerRun): {
  label: string;
  status: "idle" | "pass" | "warning" | "error";
  boundary?: string;
} {
  if (run.status === "expired") return { label: "Evidence expired", status: "warning" };
  if (run.status === "deleted") return { label: "Record deleted", status: "warning" };
  if (run.status === "failed") return { label: "Processing errors", status: "error" };
  if (run.sourceType === "custom") {
    const label = run.outcome === "clear" || run.outcome === "evidence_consistent"
      ? "Evidence-consistent"
      : run.outcome === "needs_review" || run.outcome === "conflict"
        ? "Conflict"
        : run.outcome === "incomplete" || run.outcome === "not_found"
          ? "Not found"
          : "Evidence review pending";
    return { label, status: "idle", boundary: "Evidence only - no business approval" };
  }
  if (run.outcome === "clear" || run.outcome === "evidence_consistent") {
    return { label: "Ready for posting review", status: "pass" };
  }
  if (run.outcome === "needs_review" || run.outcome === "conflict") {
    return { label: "Exception review required", status: "warning" };
  }
  if (run.outcome === "incomplete" || run.outcome === "not_found") {
    return { label: "Awaiting readable evidence", status: "warning" };
  }
  return { label: "Triage in progress", status: "warning" };
}

function fixtureIdentity(run: ExplorerRun) {
  if (run.status === "expired" || run.status === "deleted") {
    const expired = run.status === "expired";
    return {
      family: "Retained review record",
      variant: "Document identity removed after retention",
      reference: expired ? "Expired review record" : "Deleted review record",
      exception: expired ? "Evidence is no longer retained" : "Document evidence was deleted",
    };
  }
  if (run.sourceType === "custom") {
    return {
      family: "Custom document",
      variant: "Custom upload",
      reference: run.filename ?? "Custom upload",
      exception: run.outcome === "clear" || run.outcome === "evidence_consistent"
        ? "No exception recorded"
        : "Review the selected record for evidence details",
    };
  }
  const fixture = run.fixtureId ? fixtureById.get(run.fixtureId) : undefined;
  if (fixture) {
    const referenceKey = fixture.family === "supplier_invoice"
      ? "invoice_number"
      : "goods_receipt_number";
    return {
      family: fixture.family === "supplier_invoice" ? "Supplier invoice" : "Warehouse goods receipt",
      variant: fixture.variantLabel,
      reference: fixture.documentData[referenceKey] ?? fixture.filename,
      exception: fixture.differenceSummary.length
        ? fixture.differenceSummary.join(" ")
        : "No exception recorded",
    };
  }
  const family = run.documentFamily === "supplier_invoice"
    ? "Supplier invoice"
    : run.documentFamily === "warehouse_goods_receipt"
      ? "Warehouse goods receipt"
      : "Unclassified document";
  return {
    family,
    variant: "Legacy run",
    reference: run.filename ?? "Legacy document",
    exception: run.outcome === "clear" || run.outcome === "evidence_consistent"
      ? "No exception recorded"
      : "Review the selected record for evidence details",
  };
}

function selectionName(run: ExplorerRun): string {
  const identity = fixtureIdentity(run);
  const decision = reviewDecision(run);
  return `Select ${identity.reference}, ${decision.label}, received ${formatSingaporeTime(run.createdAt)}`;
}

export function RunExplorer({ runs, onSelect }: { runs: ExplorerRun[]; onSelect: (run: ExplorerRun) => void }) {
  const [initial] = useState(() => typeof window === "undefined"
    ? { provider: "all", outcome: "all", query: "", selected: "", page: 1 }
    : readUrlState());
  const [provider, setProvider] = useState(initial.provider);
  const [outcome, setOutcome] = useState(initial.outcome);
  const [query, setQuery] = useState(initial.query);
  const [selected, setSelected] = useState(initial.selected);
  const [page, setPage] = useState(initial.page);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageSize = 10;

  useEffect(() => {
    const syncFromHistory = () => {
      const next = readUrlState();
      setProvider(next.provider);
      setOutcome(next.outcome);
      setQuery(next.query);
      setSelected(next.selected);
      setPage(next.page);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  const filtered = useMemo(() => runs.filter((run) => {
    const matchesProvider = provider === "all" || (run.providerCalled && run.provider === provider);
    const matchesOutcome = outcome === "all" || run.outcome === outcome;
    const needle = query.trim().toLowerCase();
    const identity = fixtureIdentity(run);
    const matchesQuery = !needle
      || run.id.toLowerCase().includes(needle)
      || run.filename?.toLowerCase().includes(needle)
      || identity.reference.toLowerCase().includes(needle)
      || identity.variant.toLowerCase().includes(needle);
    return matchesProvider && matchesOutcome && matchesQuery;
  }), [outcome, provider, query, runs]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedRun = runs.find((run) => run.id === selected);
  const selectionNames = useMemo(() => {
    const bases = runs.map(selectionName);
    const totals = new Map<string, number>();
    for (const base of bases) totals.set(base, (totals.get(base) ?? 0) + 1);
    const occurrences = new Map<string, number>();
    return new Map(runs.map((run, index) => {
      const base = bases[index];
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      const total = totals.get(base) ?? 1;
      return [run.id, total > 1 ? `${base}, review record ${occurrence} of ${total}` : base];
    }));
  }, [runs]);

  function changeFilter(kind: "provider" | "outcome", value: string) {
    if (kind === "provider") setProvider(value);
    else setOutcome(value);
    setPage(1);
    writeUrl({ [kind]: value === "all" ? null : value, page: null });
  }

  function selectRun(run: ExplorerRun) {
    setSelected(run.id);
    writeUrl({ run: run.id });
    onSelect(run);
  }

  return (
    <div className="explorer-layout">
      <section className="run-explorer" aria-labelledby="run-explorer-heading">
        <header
          id={operationsTourTargetIds.evidenceExplorer}
          className="explorer-toolbar tour-target"
        >
          <div><h3 id="run-explorer-heading">Procurement review queue</h3><span>{filtered.length} matching review records</span></div>
          <label>Processing model filter<select value={provider} onChange={(event) => changeFilter("provider", event.target.value)}><option value="all">All processing</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
          <label>Outcome filter<select value={outcome} onChange={(event) => changeFilter("outcome", event.target.value)}><option value="all">All outcomes</option>{outcomeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="search-field">Search review records<input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); writeUrl({ q: event.target.value || null, page: null }); }} placeholder="Document reference or variant" />{query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); writeUrl({ q: null, page: null }); searchRef.current?.focus(); }}>×</button> : null}</label>
        </header>
        <div className="table-scroll table-overflow-cue" tabIndex={0} role="region" aria-label="Scrollable procurement review queue">
          <table>
            <caption className="sr-only">Procurement review queue</caption>
            <thead><tr><th scope="col">Document reference</th><th scope="col">Document type</th><th scope="col">Review decision</th><th scope="col">Exception</th><th scope="col">Prepared next step</th><th scope="col">Received time</th><th scope="col">Source check</th></tr></thead>
            <tbody>
              {visible.map((run) => {
                const identity = fixtureIdentity(run);
                const decision = reviewDecision(run);
                const retained = run.status === "expired" || run.status === "deleted";
                const receivedTime = formatSingaporeTime(run.createdAt);
                return (
                  <tr key={run.id} className={selected === run.id ? "selected-row" : ""}>
                    <th scope="row"><input type="radio" name="explorer-run" aria-label={selectionNames.get(run.id)} checked={selected === run.id} onChange={() => selectRun(run)} /><span className="table-primary">{identity.reference}</span><small>{identity.variant}</small></th>
                    <td>{identity.family}</td>
                    <td><span className="status-inline"><StatusMark status={decision.status} />{decision.label}</span>{decision.boundary ? <small>{decision.boundary}</small> : null}</td>
                    <td>{identity.exception}</td>
                    <td>{retained ? "No active handoff" : run.latestWorkflowEvent ? workflowActionLabels[run.latestWorkflowEvent.action] : "No action prepared"}</td>
                    <td><time dateTime={run.createdAt}>{receivedTime}</time></td>
                    <td>{sourceOriginLabel(run.sourceOriginStatus)}</td>
                  </tr>
                );
              })}
              {!visible.length ? <tr><td colSpan={7}><EmptyState title={runs.length ? "No matching review records" : "No review records yet"}>{runs.length ? "Clear the filters to restore the review queue." : "Assess a document in Workbench to populate this queue."}</EmptyState></td></tr> : null}
            </tbody>
          </table>
        </div>
        <nav className="pagination" aria-label="Review queue pagination">
          <span>{filtered.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length}` : "0 records"}</span>
          <Button intent="neutral" type="button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => { const next = safePage - 1; setPage(next); writeUrl({ page: String(next) }); }}>Previous</Button>
          <span aria-current="page">Page {safePage} of {pageCount}</span>
          <Button intent="neutral" type="button" aria-label="Next page" disabled={safePage >= pageCount} onClick={() => { const next = safePage + 1; setPage(next); writeUrl({ page: String(next) }); }}>Next</Button>
        </nav>
      </section>
      <aside className="run-inspector">
        {!selectedRun ? <EmptyState title="Select a review record">Extraction, evidence, differences and workflow activity will appear here.</EmptyState> : selectedRun.status === "expired" || selectedRun.status === "deleted" ? (
          <div><h3>Review record and technical trace</h3><h4>{selectedRun.status === "expired" ? "Expired run" : "Deleted run"}</h4><p>Retention metadata only. Detailed evidence and document preview are no longer available.</p><dl><div><dt>Run ID</dt><dd className="mono">{selectedRun.id}</dd></div><div><dt>Expiry</dt><dd><time dateTime={selectedRun.expiresAt}>{formatSingaporeTime(selectedRun.expiresAt)}</time></dd></div><div><dt>Source check</dt><dd>{sourceOriginLabel(selectedRun.sourceOriginStatus)}</dd></div></dl></div>
        ) : <Inspector run={selectedRun} />}
      </aside>
    </div>
  );
}

function Inspector({ run }: { run: ExplorerRun }) {
  const [detail, setDetail] = useState<PublicRunDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { setDetail(null); setError(""); });
    fetch(`/api/runs/${encodeURIComponent(run.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Run detail is temporarily unavailable.");
        return response.json();
      })
      .then((payload: { run?: PublicRunDetail }) => {
        if (!payload.run || payload.run.id !== run.id) throw new Error("Run detail is temporarily unavailable.");
        setDetail(payload.run);
      })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [run.id]);

  const fields = detail?.details?.result?.fields ?? [];
  const action = detail?.details?.result?.action;
  const steps = detail?.details?.steps ?? [];
  const workflowEvents = detail?.details?.workflowEvents ?? [];
  const safeErrors = steps.filter((step) => step.safeCode);
  const fixture = detail?.fixtureId ? fixtureById.get(detail.fixtureId) : undefined;
  const commentsKey = fixture?.handwrittenEvidence?.fieldKey;
  const commentFields = fields.filter((field) => field.key === commentsKey || field.key.includes("comments"));
  const conflictContext = detail?.sourceType === "custom"
    ? "other document evidence"
    : detail?.documentFamily === "warehouse_goods_receipt"
      ? "the warehouse receipt reference"
      : "the purchase-order reference";
  const evaluatorDifferences = fields
    .filter((field) => field.evaluatorStatus !== "pass")
    .map((field) => `${field.label} ${field.evaluatorStatus === "conflict" ? `conflicts with ${conflictContext}.` : "was not found in the document."}`);
  const differences = Array.from(new Set([...(fixture?.differenceSummary ?? []), ...evaluatorDifferences]));
  const expectedDocumentUrl = `/api/runs/${encodeURIComponent(run.id)}/document`;
  const documentUrl = detail?.documentUrl === expectedDocumentUrl ? expectedDocumentUrl : null;
  const syntheticPreviewUrl = detail?.sourceType === "synthetic" && fixture
    ? `/samples/${fixture.filename.replace(/\.pdf$/i, ".png")}`
    : null;

  return (
    <div>
      <header className="inspector-title"><div><span className="mono">{run.id}</span><h3>Review record and technical trace</h3></div><button type="button" className="copy-button" onClick={() => navigator.clipboard?.writeText(run.id)}>Copy run ID</button></header>
      {error ? <p className="inline-error" role="alert">{error}</p> : !detail ? <p className="loading-region">Loading run detail…</p> : (
        <div className="inspector-sections">
          <section className="inspector-preview"><h4>Document preview</h4>{documentUrl ? <><a href={documentUrl} target="_blank" rel="noreferrer">Open full document</a>{syntheticPreviewUrl ? <img src={syntheticPreviewUrl} alt={`Rendered preview of ${detail.file.filename}`} /> : <iframe src={documentUrl} title={`Active document preview for ${detail.file.filename}`} />}</> : <p>The active document preview is unavailable.</p>}</section>
          <section className="inspector-action"><h4>Prepared action</h4>{action ? <><strong>{action.title}</strong><p>{action.summary}</p><dl><div><dt>Type</dt><dd>{action.type.replaceAll("_", " ")}</dd></div><div><dt>Policy status</dt><dd>{action.status.replaceAll("_", " ")}</dd></div><div><dt>Staged preparation</dt><dd>{action.stagedAt ? `Staged ${formatSingaporeTime(action.stagedAt)}` : "Not staged"}</dd></div><div><dt>Risk</dt><dd>{action.risk}</dd></div></dl><dl className="action-payload">{action.payload.map((entry) => <div key={`${entry.label}-${entry.value}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>{action.instructionEvidence ? <blockquote><span>Document instruction{action.page ? ` · Page ${action.page}` : ""}</span>{action.instructionEvidence}</blockquote> : null}<p>{action.reason}</p><small>Prepared inside this demonstration. No external connector was called.</small></> : <p>No prepared action is available.</p>}</section>
          <section><h4>What differed</h4>{differences.length ? <ul className="difference-list">{differences.map((difference, index) => <li key={`${difference}-${index}`}>{difference}</li>)}</ul> : <p>No differences were recorded.</p>}</section>
          <section><h4>Comments evidence</h4>{commentFields.length ? <dl>{commentFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd><span>{field.extractedValue ?? "Not found"}</span><small>{field.evidence ?? "No evidence found"}</small><small>{field.evaluatorStatus.replaceAll("_", " ")}</small></dd></div>)}</dl> : <p>No comments evidence is available.</p>}</section>
          <section><h4>Structured extraction</h4>{fields.length ? <dl>{fields.map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.extractedValue ?? "Not found"}</span><small>Normalized: {item.normalizedValue ?? "Not found"}</small><small>Evidence: {item.evidence ?? "No evidence found"}</small></dd></div>)}</dl> : <p>No extraction fields are available.</p>}</section>
          <section><h4>Reference comparison</h4>{fields.length ? <dl>{fields.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.referenceMatch === null ? "Not applicable" : item.referenceMatch ? "Match" : "Mismatch"}</dd></div>)}</dl> : <p>No field comparison is available.</p>}</section>
          <section><h4>Processing diagnostics</h4><dl><div><dt>Latency</dt><dd>{detail.latencyMs === null ? "Unavailable" : formatMilliseconds(detail.latencyMs)}</dd></div><div><dt>Retries</dt><dd>{detail.retryCount}</dd></div><div><dt>Estimated API cost</dt><dd>US${detail.estimatedCostUsd.toFixed(4)}</dd></div></dl>{steps.length ? <ol className="inspector-steps">{steps.map((step, index) => <li key={`${step.timestamp}-${index}`}><span>{step.stage.replaceAll("_", " ")}</span><span className="mono">{formatMilliseconds(step.durationMs)}</span></li>)}</ol> : <p>No step telemetry is available.</p>}</section>
          <section><h4>Safe diagnostics</h4>{safeErrors.length ? <ul className="safe-error-list">{safeErrors.map((step, index) => <li key={`${step.timestamp}-${index}`}><code>{step.safeCode}</code><span>{step.stage.replaceAll("_", " ")}</span></li>)}</ul> : <p>No safe diagnostic codes were recorded.</p>}</section>
          <section><h4>Workflow activity</h4>{workflowEvents.length ? <ol className="workflow-event-list">{workflowEvents.map((event) => <li key={event.id}><strong>{workflowActionLabels[event.action]}</strong><span>{event.status}{event.recipientRole ? ` · ${event.recipientRole}` : ""}</span><time dateTime={event.createdAt}>{formatSingaporeTime(event.createdAt)}</time></li>)}</ol> : <p>No simulated workflow activity is available.</p>}</section>
          <section><h4>Metadata</h4><dl><div><dt>Provider</dt><dd>{processingDisplay(detail.providerCalled, detail.provider)}</dd></div><div><dt>Model</dt><dd>{processingDisplay(detail.providerCalled, detail.model)}</dd></div><div><dt>Mode</dt><dd>{detail.executionMode}</dd></div><div><dt>Source</dt><dd>{detail.sourceType}</dd></div><div><dt>Source check</dt><dd>{sourceOriginLabel(detail.sourceOriginStatus)}</dd></div><div><dt>Created</dt><dd><time dateTime={detail.createdAt}>{formatSingaporeTime(detail.createdAt)}</time></dd></div><div><dt>Expires</dt><dd><time dateTime={detail.expiresAt}>{formatSingaporeTime(detail.expiresAt)}</time></dd></div><div><dt>File</dt><dd>{detail.file.filename}</dd></div><div><dt>Pages</dt><dd>{detail.file.pageCount ?? "Unavailable"}</dd></div><div><dt>Prompt version ID</dt><dd className="mono">{detail.promptVersion}</dd></div><div><dt>Input tokens</dt><dd>{detail.usage.inputTokens}</dd></div><div><dt>Output tokens</dt><dd>{detail.usage.outputTokens}</dd></div></dl></section>
        </div>
      )}
    </div>
  );
}
