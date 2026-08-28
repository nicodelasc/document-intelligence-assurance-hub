"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, StatusMark } from "@/components/ui/primitives";
import type { FieldResult, Outcome, Provider, RunStatus } from "@/domain/types";

export type ExplorerRun = {
  id: string;
  provider: Provider;
  model: string;
  executionMode: "recorded" | "live";
  sourceType: "synthetic" | "custom";
  status: RunStatus;
  outcome: Outcome | null;
  createdAt: string;
  expiresAt: string;
  deletedAt: string | null;
  retryCount: number;
  latencyMs: number | null;
  estimatedCostUsd: number;
  filename?: string;
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
    result: null | {
      fields: FieldResult[];
      outcome: Outcome;
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
const milliseconds = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });

function formatMilliseconds(value: number | null): string {
  return value === null ? "—" : `${milliseconds.format(value)} ms`;
}

function providerCallDisplay(executionMode: ExplorerRun["executionMode"], value: string): string {
  return executionMode === "recorded" ? "Not called (demo)" : value;
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

export function RunExplorer({ runs, onSelect }: { runs: ExplorerRun[]; onSelect: (run: ExplorerRun) => void }) {
  const initial = typeof window === "undefined" ? { provider: "all", outcome: "all", query: "", selected: "", page: 1 } : readUrlState();
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
    const matchesProvider = provider === "all" || run.provider === provider;
    const matchesOutcome = outcome === "all" || run.outcome === outcome;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || run.id.toLowerCase().includes(needle) || run.filename?.toLowerCase().includes(needle);
    return matchesProvider && matchesOutcome && matchesQuery;
  }), [outcome, provider, query, runs]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedRun = runs.find((run) => run.id === selected);

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
        <header className="explorer-toolbar">
          <div><h2 id="run-explorer-heading">Run explorer</h2><span>{filtered.length} matching runs</span></div>
          <label>Provider filter<select value={provider} onChange={(event) => changeFilter("provider", event.target.value)}><option value="all">All providers</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
          <label>Outcome filter<select value={outcome} onChange={(event) => changeFilter("outcome", event.target.value)}><option value="all">All outcomes</option>{outcomeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="search-field">Search runs<input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); writeUrl({ q: event.target.value || null, page: null }); }} placeholder="Run ID or filename" />{query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); writeUrl({ q: null, page: null }); searchRef.current?.focus(); }}>×</button> : null}</label>
        </header>
        <div className="table-scroll table-overflow-cue" tabIndex={0} role="region" aria-label="Scrollable public run table">
          <table>
            <caption className="sr-only">Public assurance runs</caption>
            <thead><tr><th scope="col">Select</th><th scope="col">Run ID</th><th scope="col">Source</th><th scope="col">Provider</th><th scope="col">Status</th><th scope="col">Outcome</th><th scope="col">Latency</th><th scope="col">Expiry</th></tr></thead>
            <tbody>
              {visible.map((run) => (
                <tr key={run.id} className={selected === run.id ? "selected-row" : ""}>
                  <td><input type="radio" name="explorer-run" aria-label={`Select ${run.id}`} checked={selected === run.id} onChange={() => selectRun(run)} /></td>
                  <td><span className="mono run-id">{run.id}</span></td>
                  <td>{run.sourceType}</td><td>{providerCallDisplay(run.executionMode, run.provider)}</td>
                  <td><span className="status-inline"><StatusMark status={run.status === "failed" ? "error" : run.status === "completed" ? "pass" : "warning"} />{run.status}</span></td>
                  <td>{run.outcome?.replaceAll("_", " ") ?? "—"}</td>
                  <td className="mono">{formatMilliseconds(run.latencyMs)}</td>
                  <td>{new Intl.DateTimeFormat("en-SG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(run.expiresAt))}</td>
                </tr>
              ))}
              {!visible.length ? <tr><td colSpan={8}><EmptyState title={runs.length ? "No matching runs" : "No public runs yet"}>{runs.length ? "Clear the filters to restore the run ledger." : "Run a synthetic replay in Workbench to populate this ledger."}</EmptyState></td></tr> : null}
            </tbody>
          </table>
        </div>
        <nav className="pagination" aria-label="Run explorer pagination">
          <span>{filtered.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length}` : "0 runs"}</span>
          <Button intent="neutral" type="button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => { const next = safePage - 1; setPage(next); writeUrl({ page: String(next) }); }}>Previous</Button>
          <span aria-current="page">Page {safePage} of {pageCount}</span>
          <Button intent="neutral" type="button" aria-label="Next page" disabled={safePage >= pageCount} onClick={() => { const next = safePage + 1; setPage(next); writeUrl({ page: String(next) }); }}>Next</Button>
        </nav>
      </section>
      <aside className="run-inspector" aria-live="polite">
        {!selectedRun ? <EmptyState title="Select a run">The extraction, comparison, telemetry and safe metadata will appear here.</EmptyState> : selectedRun.status === "expired" || selectedRun.status === "deleted" ? (
          <div><h2>{selectedRun.status === "expired" ? "Expired run" : "Deleted run"}</h2><p>Retention metadata only. Detailed evidence and document preview are no longer available.</p><dl><div><dt>Run ID</dt><dd className="mono">{selectedRun.id}</dd></div><div><dt>Expired at</dt><dd>{selectedRun.expiresAt}</dd></div></dl></div>
        ) : (
          <Inspector run={selectedRun} />
        )}
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
  const steps = detail?.details?.steps ?? [];
  const safeErrors = steps.filter((step) => step.safeCode);
  const expectedDocumentUrl = `/api/runs/${encodeURIComponent(run.id)}/document`;
  const documentUrl = detail?.documentUrl === expectedDocumentUrl ? expectedDocumentUrl : null;

  return (
    <div>
      <header className="inspector-title"><div><span className="mono">{run.id}</span><h2>Run detail</h2></div><button type="button" className="copy-button" onClick={() => navigator.clipboard?.writeText(run.id)}>Copy run ID</button></header>
      {error ? <p className="inline-error" role="alert">{error}</p> : !detail ? <p className="loading-region">Loading run detail…</p> : (
        <div className="inspector-sections">
          <section className="inspector-preview"><h3>Document preview</h3>{documentUrl ? <iframe src={documentUrl} title={`Active document preview for ${detail.file.filename}`} /> : <p>The active document preview is unavailable.</p>}</section>
          <section><h3>Structured extraction</h3>{fields.length ? <dl>{fields.map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.extractedValue ?? "Not found"}</span><small>Normalized: {item.normalizedValue ?? "Not found"}</small><small>Evidence: {item.evidence ?? "No evidence found"}</small></dd></div>)}</dl> : <p>No extraction fields are available.</p>}</section>
          <section><h3>Reference comparison</h3>{fields.length ? <dl>{fields.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.referenceMatch === null ? "Not applicable" : item.referenceMatch ? "Match" : "Mismatch"}</dd></div>)}</dl> : <p>No field comparison is available.</p>}</section>
          <section><h3>Telemetry and steps</h3><dl><div><dt>Latency</dt><dd>{detail.latencyMs === null ? "Unavailable" : formatMilliseconds(detail.latencyMs)}</dd></div><div><dt>Retries</dt><dd>{detail.retryCount}</dd></div><div><dt>Estimated API cost</dt><dd>US${detail.estimatedCostUsd.toFixed(4)}</dd></div></dl>{steps.length ? <ol className="inspector-steps">{steps.map((step, index) => <li key={`${step.timestamp}-${index}`}><span>{step.stage.replaceAll("_", " ")}</span><time>{formatMilliseconds(step.durationMs)}</time></li>)}</ol> : <p>No step telemetry is available.</p>}</section>
          <section><h3>Safe errors</h3>{safeErrors.length ? <ul className="safe-error-list">{safeErrors.map((step, index) => <li key={`${step.timestamp}-${index}`}><code>{step.safeCode}</code><span>{step.stage.replaceAll("_", " ")}</span></li>)}</ul> : <p>No safe errors were recorded.</p>}</section>
          <section><h3>Metadata</h3><dl><div><dt>Provider</dt><dd>{providerCallDisplay(detail.executionMode, detail.provider)}</dd></div><div><dt>Model</dt><dd>{providerCallDisplay(detail.executionMode, detail.model)}</dd></div><div><dt>Mode</dt><dd>{detail.executionMode}</dd></div><div><dt>Source</dt><dd>{detail.sourceType}</dd></div><div><dt>Created</dt><dd>{detail.createdAt}</dd></div><div><dt>Expires</dt><dd>{detail.expiresAt}</dd></div><div><dt>File</dt><dd>{detail.file.filename}</dd></div><div><dt>Pages</dt><dd>{detail.file.pageCount ?? "Unavailable"}</dd></div><div><dt>Prompt version ID</dt><dd className="mono">{detail.promptVersion}</dd></div><div><dt>Input tokens</dt><dd>{detail.usage.inputTokens}</dd></div><div><dt>Output tokens</dt><dd>{detail.usage.outputTokens}</dd></div></dl></section>
        </div>
      )}
    </div>
  );
}
