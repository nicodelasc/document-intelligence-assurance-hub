"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, StatusMark } from "@/components/ui/primitives";
import type { Outcome, Provider, RunStatus } from "@/domain/types";

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

function writeUrl(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.pushState({}, "", url);
}

export function RunExplorer({ runs, onSelect }: { runs: ExplorerRun[]; onSelect: (run: ExplorerRun) => void }) {
  const initial = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [provider, setProvider] = useState(initial.get("provider") ?? "all");
  const [outcome, setOutcome] = useState(initial.get("outcome") ?? "all");
  const [query, setQuery] = useState(initial.get("q") ?? "");
  const [selected, setSelected] = useState(initial.get("run") ?? "");
  const [page, setPage] = useState(Math.max(1, Number(initial.get("page") ?? "1") || 1));
  const searchRef = useRef<HTMLInputElement>(null);
  const pageSize = 10;
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
          <label>Outcome filter<select value={outcome} onChange={(event) => changeFilter("outcome", event.target.value)}><option value="all">All outcomes</option><option value="clear">Clear</option><option value="needs_review">Needs review</option><option value="incomplete">Incomplete</option></select></label>
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
                  <td>{run.sourceType}</td><td>{run.provider}</td>
                  <td><span className="status-inline"><StatusMark status={run.status === "failed" ? "error" : run.status === "completed" ? "pass" : "warning"} />{run.status}</span></td>
                  <td>{run.outcome?.replaceAll("_", " ") ?? "—"}</td>
                  <td className="mono">{run.latencyMs === null ? "—" : `${run.latencyMs} ms`}</td>
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
        {!selectedRun ? <EmptyState title="Select a run">The overview, telemetry and evaluator output will appear here.</EmptyState> : selectedRun.status === "expired" || selectedRun.status === "deleted" ? (
          <div><h2>{selectedRun.status === "expired" ? "Expired run" : "Deleted run"}</h2><p>Retention metadata only. Detailed evidence and document preview are no longer available.</p><dl><div><dt>Run ID</dt><dd className="mono">{selectedRun.id}</dd></div><div><dt>Expired at</dt><dd>{selectedRun.expiresAt}</dd></div></dl></div>
        ) : (
          <Inspector run={selectedRun} />
        )}
      </aside>
    </div>
  );
}

function Inspector({ run }: { run: ExplorerRun }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      setDetail(null);
      setError("");
    });
    fetch(`/api/runs/${encodeURIComponent(run.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Run detail is temporarily unavailable.");
        return response.json();
      })
      .then((payload) => setDetail(payload.run as Record<string, unknown>))
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [run.id]);
  const details = detail?.details as { result?: { fields?: Array<{ label: string; extractedValue: string | null; evidence: string | null; evaluatorStatus: string }> } } | undefined;
  return (
    <div>
      <header className="inspector-title"><div><span className="mono">{run.id}</span><h2>Run detail</h2></div><button type="button" className="copy-button" onClick={() => navigator.clipboard?.writeText(run.id)}>Copy run ID</button></header>
      <nav className="inspector-tabs" aria-label="Run detail views"><span aria-current="page">Overview</span><span>Telemetry</span><span>Evaluator outputs</span><span>Comparison</span><span>Safe errors</span><span>Metadata</span></nav>
      {error ? <p className="inline-error" role="alert">{error}</p> : !detail ? <p className="loading-region">Loading run detail…</p> : (
        <div className="inspector-grid">
          <section><h3>Document preview</h3><a href={`/api/runs/${encodeURIComponent(run.id)}/document`} target="_blank" rel="noreferrer">Open active document</a></section>
          <section><h3>Structured extraction</h3>{details?.result?.fields?.length ? <dl>{details.result.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.extractedValue ?? "Not found"}</dd></div>)}</dl> : <p>No extraction fields are available.</p>}</section>
          <section><h3>Evidence snippets</h3>{details?.result?.fields?.map((field) => <p key={field.label}><strong>{field.label}</strong><br />{field.evidence ?? "No evidence found"}</p>)}</section>
          <section><h3>Evaluator outputs</h3>{details?.result?.fields?.map((field) => <p key={field.label}>{field.label}: {field.evaluatorStatus}</p>)}</section>
          <section><h3>Purchase-order comparison</h3><p>The public comparison exposes field match status only.</p></section>
          <section><h3>Prompt version identifiers</h3><p className="mono">{String(detail.promptVersion ?? "Unavailable")}</p></section>
        </div>
      )}
    </div>
  );
}
