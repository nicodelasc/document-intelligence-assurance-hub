"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Outcome, Provider } from "@/domain/types";
import { liveModelCatalog } from "@/domain/live-model-catalog";
import { MAX_FILE_BYTES, validateUpload } from "@/domain/file-validation";
import { Button } from "@/components/ui/primitives";

export type CustomUploadState = {
  file: File | null;
  fields: string[];
  consent: boolean;
  valid: boolean;
};

export type CustomUploadHandle = {
  openFilePicker: () => void;
  validate: () => Promise<boolean>;
};

export type ModelOption = {
  id: string;
  provider: Provider;
  displayName: string;
  recommended: boolean;
};

const modelGroups = [
  { provider: "openai" as const, label: "OpenAI" },
  { provider: "anthropic" as const, label: "Anthropic" },
];

const fileValidationMessage: Record<string, string> = {
  empty_file: "Choose a non-empty document.",
  unsupported_format: "Upload a PDF, PNG or JPG document.",
  mime_mismatch: "The file type does not match its content. Choose the original PDF, PNG or JPG file.",
  file_too_large: "The document must be 3 MB or smaller.",
  pdf_page_limit: "PDF documents must contain no more than five pages.",
};

async function validateDocument(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) return fileValidationMessage.file_too_large;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksLikePdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  let pageCount: number | undefined;
  if (looksLikePdf) {
    try {
      const { PDFDocument } = await import("pdf-lib");
      pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
    } catch {
      return "The PDF structure could not be validated. Choose an unencrypted PDF with up to five pages.";
    }
  }
  const validation = validateUpload({
    bytes,
    filename: file.name,
    reportedType: file.type,
    requestedFields: [],
    consent: false,
    pageCount,
    sourceType: "synthetic",
  });
  return validation.valid ? "" : fileValidationMessage[validation.errors[0]] ?? "The document could not be validated.";
}

export function ModelSelector({
  models,
  value,
  onChange,
  disabled = false,
}: {
  models: readonly ModelOption[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="model-selector">
      <label htmlFor="workbench-model">Processing model</label>
      <select
        id="workbench-model"
        name="model"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {modelGroups.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {models
              .filter((model) => model.provider === group.provider)
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}{model.recommended ? " - Recommended" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <small>The selected model applies to built-in samples and custom uploads.</small>
    </div>
  );
}

export const CustomUploadFields = forwardRef<CustomUploadHandle, { onReadyChange: (state: CustomUploadState) => void; disabled?: boolean }>(function CustomUploadFields({ onReadyChange, disabled = false }, ref) {
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState(["", ""]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fileValid, setFileValid] = useState(false);
  const [fileChecking, setFileChecking] = useState(false);
  const [fileFocusProxy, setFileFocusProxy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Array<HTMLInputElement | null>>([]);
  const selectionRef = useRef(0);

  const valid = Boolean(file && fileValid && !fileChecking && fields.every((field) => field.trim()) && new Set(fields.map((field) => field.trim().toLowerCase())).size === fields.length && consent);

  useEffect(() => {
    onReadyChange({ file, fields, consent, valid });
  }, [consent, fields, file, onReadyChange, valid]);

  const selectFile = useCallback(async (selected: File | null) => {
    if (disabled) return;
    const selectionId = ++selectionRef.current;
    setFileFocusProxy(false);
    setFile(selected);
    setFileValid(false);
    setErrors((current) => ({ ...current, file: "" }));
    if (!selected) return;
    setFileChecking(true);
    const message = await validateDocument(selected);
    if (selectionId !== selectionRef.current) return;
    setFileChecking(false);
    setFileValid(!message);
    setErrors((current) => ({ ...current, file: message }));
  }, [disabled]);

  const validate = useCallback(async () => {
    const next: Record<string, string> = {};
    if (!file) next.file = "Choose one PDF, PNG or JPG document.";
    else {
      setFileChecking(true);
      next.file = await validateDocument(file);
      setFileChecking(false);
      setFileValid(!next.file);
      if (!next.file) delete next.file;
    }
    const seen = new Map<string, number>();
    fields.forEach((field, index) => {
      if (!field.trim()) next[`field-${index}`] = "Enter a reviewer-defined field label.";
      const normalized = field.trim().toLowerCase();
      if (normalized && seen.has(normalized)) next[`field-${index}`] = "Field labels must be unique.";
      else if (normalized) seen.set(normalized, index);
    });
    if (!consent) next.consent = "Consent is required before a custom upload can be sent.";
    setErrors(next);
    if (next.file) {
      setFileFocusProxy(true);
      requestAnimationFrame(() => fileRef.current?.focus());
    }
    else {
      const index = fields.findIndex((_, fieldIndex) => next[`field-${fieldIndex}`]);
      if (index >= 0) requestAnimationFrame(() => fieldRefs.current[index]?.focus());
      else if (next.consent) requestAnimationFrame(() => document.getElementById("upload-consent")?.focus());
    }
    return Object.keys(next).length === 0;
  }, [consent, fields, file]);

  useImperativeHandle(ref, () => ({
    openFilePicker: () => {
      if (!disabled) fileRef.current?.click();
    },
    validate,
  }), [disabled, validate]);

  return (
    <div className="custom-fields">
      <div
        className={`drop-zone${fileFocusProxy ? " drop-zone--focus-proxy" : ""}`}
        aria-busy={fileChecking}
        aria-disabled={disabled}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (disabled) return;
          const selected = event.dataTransfer.files[0] ?? null;
          void selectFile(selected);
        }}
      >
        <label htmlFor="custom-document" className="button button--neutral" aria-disabled={disabled} onPointerDown={() => { if (!disabled) setFileFocusProxy(false); }}>Choose document</label>
        <input
          ref={fileRef}
          id="custom-document"
          className="visually-hidden-input"
          aria-label="Document file"
          type="file"
          disabled={disabled}
          accept="application/pdf,image/png,image/jpeg"
          onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
          onBlur={() => setFileFocusProxy(false)}
          aria-invalid={Boolean(errors.file)}
          aria-describedby="file-limits file-error"
        />
        <span>{fileChecking ? "Checking document…" : file ? file.name : "Drop one file here or use the picker"}</span>
        <small id="file-limits">PDF, PNG or JPG · Maximum 3 MB · PDFs up to five pages</small>
        <span id="file-error" className="field-error">{errors.file}</span>
      </div>
      <fieldset disabled={disabled}>
        <legend>Reviewer-defined extraction fields</legend>
        {fields.map((field, index) => (
          <div className="field-row" key={index}>
            <label htmlFor={`review-field-${index}`}>Review field {index + 1}</label>
            <input
              ref={(node) => { fieldRefs.current[index] = node; }}
              id={`review-field-${index}`}
              value={field}
              onChange={(event) => {
                setFields((current) => current.map((value, fieldIndex) => fieldIndex === index ? event.target.value : value));
                setErrors((current) => ({ ...current, [`field-${index}`]: "" }));
              }}
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
        <input id="upload-consent" type="checkbox" checked={consent} disabled={disabled} onChange={(event) => { setConsent(event.target.checked); setErrors((current) => ({ ...current, consent: "" })); }} aria-describedby="consent-warning consent-error" />
        <span>I understand that the raw file and result will be publicly visible for less than 24 hours.</span>
      </label>
      <p id="consent-warning" className="privacy-warning">Do not upload personal, confidential, client or regulated data.</p>
      <span id="consent-error" className="field-error">{errors.consent}</span>
      <Button type="button" intent="neutral" onClick={() => void validate()} busy={fileChecking} disabled={disabled}>Validate custom upload</Button>
    </div>
  );
});

export type ComparableRun = {
  id: string;
  providerCalled: boolean;
  provider: Provider | null;
  model: string | null;
  configuredProvider: Provider;
  configuredModel: string;
  executionMode: "recorded" | "live";
  requestedFields: string[];
  values: string[];
  evidence: string[];
  evaluator: string[];
  latencyMs: number;
  outcome: Outcome;
};

const modelDisplayNames = new Map<string, string>(liveModelCatalog.map((model) => [model.id, model.displayName]));

function executionTarget(run: ComparableRun): string {
  return run.providerCalled
    ? `${run.provider ?? "Unavailable"} · ${run.model ?? "Unavailable"}`
    : "Not called (demo)";
}

function configuredTarget(run: ComparableRun): string {
  return `${run.configuredProvider} · ${modelDisplayNames.get(run.configuredModel) ?? run.configuredModel}`;
}

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
    ["Provider and model", executionTarget(left), executionTarget(right)],
    ["Selected configuration", configuredTarget(left), configuredTarget(right)],
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
