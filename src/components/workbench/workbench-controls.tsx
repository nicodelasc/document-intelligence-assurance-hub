"use client";

import { useEffect, useRef, useState } from "react";
import type { Outcome, Provider } from "@/domain/types";
import { Button } from "@/components/ui/primitives";

export type CustomUploadState = {
  file: File | null;
  fields: string[];
  consent: boolean;
  valid: boolean;
};

export function ProviderSelector({ value, onChange }: { value: Provider; onChange: (provider: Provider) => void }) {
  return (
    <fieldset className="provider-selector">
      <legend>Provider for this run <span>Recorded replay</span></legend>
      <label className={value === "openai" ? "selected-control" : ""}>
        <input type="radio" name="provider" value="openai" checked={value === "openai"} onChange={() => onChange("openai")} />
        <span><strong>OpenAI GPT-5 mini</strong><small>Recorded benchmark comparison</small></span>
      </label>
      <label className={value === "anthropic" ? "selected-control" : ""}>
        <input type="radio" name="provider" value="anthropic" checked={value === "anthropic"} onChange={() => onChange("anthropic")} />
        <span><strong>Anthropic Claude Haiku 4.5</strong><small>Recorded benchmark comparison</small></span>
      </label>
    </fieldset>
  );
}

export function CustomUploadFields({ onReadyChange }: { onReadyChange: (state: CustomUploadState) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState(["", ""]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Array<HTMLInputElement | null>>([]);

  const valid = Boolean(file && fields.every((field) => field.trim()) && new Set(fields.map((field) => field.trim().toLowerCase())).size === fields.length && consent);

  useEffect(() => {
    onReadyChange({ file, fields, consent, valid });
  }, [consent, fields, file, onReadyChange, valid]);

  function validate() {
    const next: Record<string, string> = {};
    if (!file) next.file = "Choose one PDF, PNG or JPG document.";
    fields.forEach((field, index) => {
      if (!field.trim()) next[`field-${index}`] = "Enter a reviewer-defined field label.";
    });
    if (new Set(fields.map((field) => field.trim().toLowerCase()).filter(Boolean)).size !== fields.filter((field) => field.trim()).length) {
      next["field-1"] = "Field labels must be unique.";
    }
    if (!consent) next.consent = "Consent is required before a custom upload can be sent.";
    setErrors(next);
    if (next.file) fileRef.current?.focus();
    else {
      const index = fields.findIndex((_, fieldIndex) => next[`field-${fieldIndex}`]);
      if (index >= 0) fieldRefs.current[index]?.focus();
      else if (next.consent) document.getElementById("upload-consent")?.focus();
    }
  }

  return (
    <div className="custom-fields">
      <div
        className="drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const selected = event.dataTransfer.files[0] ?? null;
          setFile(selected);
          setErrors((current) => ({ ...current, file: "" }));
        }}
      >
        <label htmlFor="custom-document" className="button button--neutral">Choose document</label>
        <input
          ref={fileRef}
          id="custom-document"
          className="visually-hidden-input"
          aria-label="Document file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          aria-invalid={Boolean(errors.file)}
          aria-describedby="file-limits file-error"
        />
        <span>{file ? file.name : "Drop one file here or use the picker"}</span>
        <small id="file-limits">PDF, PNG or JPG · Maximum 3 MB · PDFs up to five pages</small>
        <span id="file-error" className="field-error">{errors.file}</span>
      </div>
      <fieldset>
        <legend>Reviewer-defined extraction fields</legend>
        {fields.map((field, index) => (
          <div className="field-row" key={index}>
            <label htmlFor={`review-field-${index}`}>Review field {index + 1}</label>
            <input
              ref={(node) => { fieldRefs.current[index] = node; }}
              id={`review-field-${index}`}
              value={field}
              onChange={(event) => setFields((current) => current.map((value, fieldIndex) => fieldIndex === index ? event.target.value : value))}
              aria-invalid={Boolean(errors[`field-${index}`])}
              aria-describedby={`review-field-error-${index}`}
            />
            <span className="field-error" id={`review-field-error-${index}`}>{errors[`field-${index}`]}</span>
          </div>
        ))}
        {fields.length === 2 ? (
          <Button intent="ghost" type="button" onClick={() => setFields((current) => [...current, ""])}>Add a third field</Button>
        ) : (
          <Button intent="ghost" type="button" onClick={() => setFields((current) => current.slice(0, 2))}>Remove third field</Button>
        )}
      </fieldset>
      <label className="consent-row" htmlFor="upload-consent">
        <input id="upload-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} aria-describedby="consent-warning consent-error" />
        <span>I understand that the raw file and result will be publicly visible for less than 24 hours.</span>
      </label>
      <p id="consent-warning" className="privacy-warning">Do not upload personal, confidential, client or regulated data.</p>
      <span id="consent-error" className="field-error">{errors.consent}</span>
      <Button type="button" intent="neutral" onClick={validate}>Validate custom upload</Button>
    </div>
  );
}

export type ComparableRun = {
  id: string;
  provider: Provider;
  model: string;
  executionMode: "recorded" | "live";
  requestedFields: string[];
  values: string[];
  evidence: string[];
  evaluator: string[];
  latencyMs: number;
  outcome: Outcome;
};

export function ComparisonLedger({ runs, leftId, rightId }: { runs: ComparableRun[]; leftId: string; rightId: string }) {
  const left = runs.find((run) => run.id === leftId);
  const right = runs.find((run) => run.id === rightId);
  if (!left || !right || left.id === right.id) {
    return <p className="inline-guidance">Choose two distinct runs to compare.</p>;
  }
  const rows = [
    ["Requested fields", left.requestedFields.join(" · "), right.requestedFields.join(" · ")],
    ["Extracted and normalized values", left.values.join(" · "), right.values.join(" · ")],
    ["Evidence", left.evidence.join(" · "), right.evidence.join(" · ")],
    ["Provider and model", `${left.provider} · ${left.model}`, `${right.provider} · ${right.model}`],
    ["Execution mode", left.executionMode, right.executionMode],
    ["Evaluator status", left.evaluator.join(" · "), right.evaluator.join(" · ")],
    ["Latency", `${left.latencyMs} ms`, `${right.latencyMs} ms`],
    ["Outcome", left.outcome, right.outcome],
  ];
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable run comparison table">
      <table>
        <caption className="sr-only">Comparison of two assurance runs</caption>
        <thead><tr><th scope="col">Dimension</th><th scope="col">Run A</th><th scope="col">Run B</th></tr></thead>
        <tbody>{rows.map(([label, leftValue, rightValue]) => <tr key={label}><th scope="row">{label}</th><td>{leftValue}</td><td>{rightValue}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
