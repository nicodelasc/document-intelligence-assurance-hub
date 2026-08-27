"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import type { FieldResult, Outcome, Provider, RunEvent, RunStatus } from "@/domain/types";
import { recordedRunResults, syntheticInvoices } from "@/domain/fixtures";
import { Button, EmptyState, KeylessNotice, LiveRegion, RulePanel, StatusMark } from "@/components/ui/primitives";
import { DangerDialog } from "@/components/ui/dialog";
import { ComparisonLedger, CustomUploadFields, ProviderSelector, type ComparableRun, type CustomUploadState } from "./workbench-controls";
import { consumeNdjson } from "./run-stream";

const traceStages: Array<{ key: RunStatus; label: string }> = [
  { key: "validating", label: "Validate" },
  { key: "storing", label: "Store" },
  { key: "extracting", label: "Extract" },
  { key: "verifying", label: "Verify fields" },
  { key: "comparing", label: "Compare" },
  { key: "deciding", label: "Decide" },
  { key: "publishing", label: "Publish telemetry" },
];

const sampleCopy = {
  "clean-match": { title: "Clean invoice", description: "Matches its purchase order" },
  "invoice-total-mismatch": { title: "Invoice-total mismatch", description: "Requires review" },
  "missing-purchase-order": { title: "Missing purchase-order number", description: "Incomplete evidence" },
};

const outcomeLabel: Record<Outcome, string> = {
  clear: "Clear",
  needs_review: "Needs review",
  incomplete: "Incomplete",
  evidence_consistent: "Evidence-consistent",
  conflict: "Conflict",
  not_found: "Not found",
};

type TraceState = Record<string, { status: "idle" | "active" | "pass" | "error"; duration: number | null }>;

function freshTrace(): TraceState {
  return Object.fromEntries(traceStages.map((stage) => [stage.key, { status: "idle", duration: null }]));
}

function safeStoreDeletion(runId: string, token: string, expiresAt: string) {
  try {
    localStorage.setItem(`assurance-delete:${runId}`, JSON.stringify({ token, expiresAt }));
  } catch {
    // Browser storage can be unavailable. The one-time receipt remains visible in this session.
  }
}

export function WorkbenchView() {
  const [source, setSource] = useState<"synthetic" | "custom">("synthetic");
  const [sampleId, setSampleId] = useState<(typeof syntheticInvoices)[number]["id"]>("clean-match");
  const [provider, setProvider] = useState<Provider>("openai");
  const [custom, setCustom] = useState<CustomUploadState>({ file: null, fields: ["", ""], consent: false, valid: false });
  const [previewUrl, setPreviewUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceState>(freshTrace);
  const [fields, setFields] = useState<FieldResult[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("Ready for a recorded replay.");
  const [history, setHistory] = useState<ComparableRun[]>([]);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [deletionReceipt, setDeletionReceipt] = useState<{ runId: string; token: string; expiresAt: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const startedRef = useRef(0);
  const lastStageRef = useRef<{ key: RunStatus; at: number } | null>(null);

  useEffect(() => {
    if (!custom.file) {
      queueMicrotask(() => setPreviewUrl(""));
      return;
    }
    const url = URL.createObjectURL(custom.file);
    queueMicrotask(() => setPreviewUrl(url));
    return () => URL.revokeObjectURL(url);
  }, [custom.file]);

  const fixture = useMemo(() => recordedRunResults.find((candidate) => candidate.invoiceId === sampleId) ?? recordedRunResults[0], [sampleId]);
  const selectedInvoice = syntheticInvoices.find((candidate) => candidate.id === sampleId) ?? syntheticInvoices[0];

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
      const label = traceStages.find((stage) => stage.key === event.stage)?.label ?? event.stage;
      setLiveMessage(`${label} stage started.`);
    } else if (event.type === "field") {
      setFields((current) => [...current.filter((field) => field.key !== event.field.key), event.field]);
    }
  }, []);

  async function runAssurance() {
    if (running) return;
    if (source === "custom" && !custom.valid) {
      setError("Complete the document, field labels and consent before running a custom check.");
      document.getElementById("custom-document")?.focus();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    startedRef.current = performance.now();
    lastStageRef.current = null;
    setRunning(true);
    setError("");
    setOutcome(null);
    setFields([]);
    setTrace(freshTrace());
    setLiveMessage("Assurance run started.");
    const form = new FormData();
    form.set("sourceType", source);
    form.set("provider", provider);
    form.set("executionMode", source === "synthetic" ? "recorded" : "live");
    if (source === "synthetic") form.set("sampleId", sampleId);
    else if (custom.file) {
      form.set("document", custom.file);
      custom.fields.forEach((field) => form.append("requestedField", field));
      form.set("consent", String(custom.consent));
    }
    try {
      const response = await fetch("/api/runs", { method: "POST", body: form, signal: controller.signal });
      const terminal = await consumeNdjson(response, { onEvent: (event) => onStreamEvent(event, requestId) });
      if (requestId !== requestRef.current) return;
      const elapsed = performance.now() - startedRef.current;
      if (terminal.type === "failed") {
        setError(terminal.message);
        setLiveMessage(`Run stopped. ${terminal.message}`);
        return;
      }
      setTrace((current) => {
        const next = { ...current };
        for (const stage of traceStages) next[stage.key] = { status: "pass", duration: next[stage.key]?.duration ?? Math.max(1, elapsed / traceStages.length) };
        return next;
      });
      setOutcome(terminal.outcome);
      setLiveMessage(`Run complete. Outcome: ${outcomeLabel[terminal.outcome]}.`);
      const completedFields = fields.length ? fields : fixture.fields;
      const comparable: ComparableRun = {
        id: terminal.runId,
        provider,
        model: provider === "openai" ? "GPT-5 mini" : "Claude Haiku 4.5",
        executionMode: terminal.executionMode,
        requestedFields: completedFields.map((field) => field.label),
        values: completedFields.map((field) => field.normalizedValue ?? "Not found"),
        evidence: completedFields.map((field) => field.evidence ?? "No evidence found"),
        evaluator: completedFields.map((field) => field.evaluatorStatus),
        latencyMs: Math.round(elapsed),
        outcome: terminal.outcome,
      };
      setHistory((current) => [comparable, ...current.filter((run) => run.id !== comparable.id)]);
      if (source === "custom" && terminal.deletionToken) {
        const receipt = { runId: terminal.runId, token: terminal.deletionToken, expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() };
        setDeletionReceipt(receipt);
        safeStoreDeletion(receipt.runId, receipt.token, receipt.expiresAt);
      }
    } catch (reason) {
      if (requestId !== requestRef.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setLiveMessage("Run cancelled. The selected source is still available.");
      } else {
        const message = reason instanceof Error ? reason.message : "The run could not be completed.";
        setError(message);
        setLiveMessage(`Run stopped. ${message}`);
      }
    } finally {
      if (requestId === requestRef.current) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }

  function cancelRun() {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setTrace(freshTrace());
    setLiveMessage("Run cancelled. The selected source is still available.");
    requestAnimationFrame(() => runButtonRef.current?.focus());
  }

  async function deleteRun() {
    if (!deletionReceipt) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(deletionReceipt.runId)}`, { method: "DELETE", headers: { "x-delete-token": deletionReceipt.token } });
      if (!response.ok) throw new Error("Deletion could not be confirmed. Retry with the same browser-held token.");
      try { localStorage.removeItem(`assurance-delete:${deletionReceipt.runId}`); } catch { /* no-op */ }
      setHistory((current) => current.filter((run) => run.id !== deletionReceipt.runId));
      setDeletionReceipt(null);
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
            <fieldset className="source-mode">
              <legend>Document source</legend>
              <label><input type="radio" name="source-mode" checked={source === "synthetic"} onChange={() => setSource("synthetic")} /> Synthetic fixture</label>
              <label><input type="radio" name="source-mode" checked={source === "custom"} onChange={() => setSource("custom")} /> Custom upload</label>
            </fieldset>
            {source === "synthetic" ? (
              <fieldset className="sample-list"><legend>Choose a sample</legend>{syntheticInvoices.map((sample) => <label key={sample.id} className={sampleId === sample.id ? "selected-control" : ""}><input type="radio" name="sample" value={sample.id} checked={sampleId === sample.id} onChange={() => setSampleId(sample.id)} /><span><strong>{sampleCopy[sample.id].title}</strong><small>{sampleCopy[sample.id].description}</small></span></label>)}</fieldset>
            ) : <CustomUploadFields onReadyChange={setCustom} />}
          </RulePanel>

          <section className="document-work-area">
            <div className="run-controls">
              <ProviderSelector value={provider} onChange={setProvider} />
              <div className="run-actions"><Button ref={runButtonRef} type="submit" busy={running}>Run assurance check</Button>{running ? <Button type="button" intent="ghost" onClick={cancelRun}>Cancel run</Button> : null}</div>
            </div>
            {error ? <div className="inline-error recovery-error" role="alert"><strong>Run unavailable</strong><span>{error}</span>{source === "custom" ? <Button type="button" intent="neutral" onClick={() => { setSource("synthetic"); setError(""); }}>Use a synthetic recorded replay</Button> : null}</div> : null}
            <DocumentPreview source={source} sampleId={sampleId} selectedInvoice={selectedInvoice} custom={custom} previewUrl={previewUrl} />
          </section>

          <aside className="assurance-rail">
            <RulePanel title="Assurance trace">
              <ol className="trace-list">{traceStages.map((stage) => { const state = trace[stage.key]; return <li key={stage.key} className={state.status === "active" ? "trace-active" : ""}><StatusMark status={state.status} /><span><strong>{stage.label}</strong><small>{state.status === "active" ? "In progress" : state.status === "pass" ? "Completed" : "Pending"}</small></span><time>{state.duration === null ? "—" : `${(state.duration / 1000).toFixed(1)} s`}</time></li>; })}</ol>
            </RulePanel>
            <RulePanel title="Result and extracted fields">
              {!outcome ? <EmptyState title="Awaiting a run">Field evidence will appear here without shifting the trace.</EmptyState> : <ResultLedger outcome={outcome} fields={fields.length ? fields : fixture.fields} />}
            </RulePanel>
          </aside>
        </div>
      </form>

      <section className="history-band" aria-labelledby="history-heading">
        <header><div><h2 id="history-heading">Public run history</h2><p>Active details remain visible for less than 24 hours.</p></div><span>{history.length} runs in this browser session</span></header>
        {!history.length ? <EmptyState title="No runs to compare">Complete two recorded replays to compare their evidence and outcomes.</EmptyState> : (
          <div className="comparison-controls"><label>Run A<select value={leftId} onChange={(event) => setLeftId(event.target.value)}><option value="">Select run A</option>{history.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}</select></label><label>Run B<select value={rightId} onChange={(event) => setRightId(event.target.value)}><option value="">Select run B</option>{history.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}</select></label></div>
        )}
        <ComparisonLedger runs={history} leftId={leftId} rightId={rightId} />
      </section>

      {deletionReceipt ? <aside className="deletion-receipt" aria-labelledby="deletion-receipt-title"><ShieldCheck aria-hidden="true" /><div><h2 id="deletion-receipt-title">Early deletion is available</h2><p>This one-time deletion token is stored only in this browser until expiry. It is never placed in a URL.</p><output className="mono">{deletionReceipt.token}</output></div><Button type="button" intent="danger" onClick={() => setDeleteDialogOpen(true)}>Delete now</Button></aside> : null}
      <DangerDialog open={deleteDialogOpen} title="Delete this public run?" description="The raw file and detailed trace will be permanently removed. This action cannot be undone." objectName={deletionReceipt?.runId ?? ""} busy={deleting} error={deleteError} onCancel={() => setDeleteDialogOpen(false)} onConfirm={deleteRun} />
    </main>
  );
}

function DocumentPreview({ source, sampleId, selectedInvoice, custom, previewUrl }: { source: "synthetic" | "custom"; sampleId: string; selectedInvoice: (typeof syntheticInvoices)[number]; custom: CustomUploadState; previewUrl: string }) {
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
  const fixture = recordedRunResults.find((candidate) => candidate.invoiceId === sampleId) ?? recordedRunResults[0];
  const values = Object.fromEntries(fixture.fields.map((field) => [field.key, field.extractedValue]));
  return (
    <RulePanel className="document-preview" title="Document preview" action={<a href={`/samples/${selectedInvoice.filename}`} target="_blank" rel="noreferrer">Open fixture PDF</a>}>
      <article className="invoice-sheet" aria-label={`Synthetic invoice from ${selectedInvoice.vendor}`}>
        <header><div><span className="invoice-kicker">Synthetic supplier invoice</span><h2>{selectedInvoice.vendor}</h2><p>Public-safe recorded fixture</p></div><strong>INVOICE</strong></header>
        <div className="invoice-meta"><dl><div><dt>Vendor name</dt><dd>{values.vendor_name}</dd></div><div><dt>Purchase-order number</dt><dd>{values.purchase_order_number ?? "Not present"}</dd></div><div><dt>Invoice total</dt><dd>{values.invoice_total}</dd></div></dl></div>
        <div className="invoice-lines"><span>Evidence line</span><span>Description</span><span>Amount</span><span>01</span><span>Regional office materials</span><span>{values.invoice_total}</span><span>02</span><span>Reference comparison</span><span>Recorded</span></div>
        <footer><span>Fixture ID</span><code>{sampleId}</code></footer>
      </article>
    </RulePanel>
  );
}

function ResultLedger({ outcome, fields }: { outcome: Outcome; fields: FieldResult[] }) {
  const custom = outcome === "evidence_consistent" || outcome === "conflict" || outcome === "not_found";
  return <div className="result-ledger"><header><StatusMark status={outcome === "clear" || outcome === "evidence_consistent" ? "pass" : outcome === "incomplete" || outcome === "not_found" ? "warning" : "error"} /><div><h3>{outcomeLabel[outcome]}</h3><p>{custom ? "This label describes document evidence only. It does not approve any business action." : "Guided fixture outcome from a recorded replay."}</p></div></header><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable extracted field ledger"><table><caption className="sr-only">Extracted field evidence ledger</caption><thead><tr><th scope="col">Field</th><th scope="col">Extracted value</th><th scope="col">Evidence snippet</th><th scope="col">Page</th><th scope="col">Evaluator status</th><th scope="col">Reference match</th></tr></thead><tbody>{fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th><td>{field.extractedValue ?? "Not found"}</td><td className="evidence-cell">{field.evidence ?? "No evidence found"}</td><td>{field.page ?? "—"}</td><td>{field.evaluatorStatus.replaceAll("_", " ")}</td><td>{field.referenceMatch === null ? "Not applicable" : field.referenceMatch ? "Match" : "Mismatch"}</td></tr>)}</tbody></table></div></div>;
}
