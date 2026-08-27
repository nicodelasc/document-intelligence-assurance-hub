import { PDFDocument } from "pdf-lib";
import { syntheticInvoices } from "@/domain/fixtures";
import { validateUpload } from "@/domain/file-validation";
import type { Provider } from "@/domain/types";
import type {
  ExecutionMode,
  RequestedField,
  SourceType,
} from "@/server/repositories/run-repository";
import type { HttpContainer } from "@/server/http/container";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 4_000_000;
const MAX_FILENAME_LENGTH = 120;
const MAX_FIELD_LABEL_LENGTH = 80;

type SyntheticInvoice = (typeof syntheticInvoices)[number];

export type ParsedRunRequest = {
  sourceType: SourceType;
  provider: Provider;
  executionMode: ExecutionMode;
  sample: SyntheticInvoice | null;
  file: {
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
    pageCount?: number;
  };
  requestedFields: RequestedField[];
  consent: boolean;
  referenceData?: Record<string, string | null>;
};

export class MultipartInputError extends Error {
  readonly name = "MultipartInputError";

  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function requiredString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new MultipartInputError("missing_field", `The ${key} field is required.`, 400);
  }
  return value.trim();
}

function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "document";
  const cleaned = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || "document";
}

function sanitizeFieldLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LABEL_LENGTH);
}

function fieldKey(label: string): string {
  const key = label
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return key || "requested_field";
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return document.getPageCount();
  } catch {
    throw new MultipartInputError(
      "invalid_pdf",
      "The PDF structure could not be validated.",
      400,
    );
  }
}

function parseProvider(value: string): Provider {
  if (value === "openai" || value === "anthropic") return value;
  throw new MultipartInputError(
    "invalid_provider",
    "Choose one supported provider.",
    400,
  );
}

function parseExecutionMode(value: FormDataEntryValue | null): ExecutionMode {
  if (value === null || value === "recorded") return "recorded";
  if (value === "live") return "live";
  throw new MultipartInputError(
    "invalid_execution_mode",
    "Choose recorded or live execution mode.",
    400,
  );
}

function validationError(code: string): MultipartInputError {
  const messages: Record<string, string> = {
    empty_file: "Choose a non-empty document.",
    unsupported_format: "Upload a PDF, PNG or JPG document.",
    mime_mismatch: "The file type does not match its content.",
    file_too_large: "The document must be 3 MB or smaller.",
    pdf_page_limit: "PDF documents must contain no more than five pages.",
    field_count: "Choose exactly two or three fields.",
    blank_field: "Field labels cannot be blank.",
    duplicate_field: "Field labels must be unique.",
    consent_required: "Consent is required for a custom upload.",
  };
  return new MultipartInputError(
    code,
    messages[code] ?? "The document did not pass validation.",
    code === "file_too_large" ? 413 : 400,
  );
}

async function parseForm(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLocaleLowerCase().startsWith("multipart/form-data")) {
    throw new MultipartInputError(
      "invalid_content_type",
      "Submit the run as multipart form data.",
      415,
    );
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    throw validationError("file_too_large");
  }
  try {
    return await request.formData();
  } catch {
    throw new MultipartInputError(
      "invalid_multipart",
      "The multipart request could not be read.",
      400,
    );
  }
}

function fixedRequestedFields(): RequestedField[] {
  return [
    { key: "vendor_name", label: "Vendor name" },
    { key: "purchase_order_number", label: "Purchase-order number" },
    { key: "invoice_total", label: "Invoice total" },
  ];
}

function referenceData(sampleId: SyntheticInvoice["id"]): Record<string, string | null> {
  const references = {
    "clean-match": {
      vendor_name: "Northstar Paperworks",
      purchase_order_number: "PO-NP-1001",
      invoice_total: "1250.00 SGD",
    },
    "invoice-total-mismatch": {
      vendor_name: "Harborline Supplies",
      purchase_order_number: "PO-HS-2001",
      invoice_total: "840.00 SGD",
    },
    "missing-purchase-order": {
      vendor_name: "Vireo Office Goods",
      purchase_order_number: "PO-VO-3001",
      invoice_total: "460.00 SGD",
    },
  } as const;
  return references[sampleId];
}

export async function parseRunMultipart(
  request: Request,
  container: Pick<HttpContainer, "loadSyntheticDocument">,
): Promise<ParsedRunRequest> {
  const form = await parseForm(request);
  const sourceValue = requiredString(form, "sourceType");
  if (sourceValue !== "synthetic" && sourceValue !== "custom") {
    throw new MultipartInputError(
      "invalid_source_type",
      "Choose a synthetic sample or custom upload.",
      400,
    );
  }
  const sourceType: SourceType = sourceValue;
  const provider = parseProvider(requiredString(form, "provider"));
  const executionMode = parseExecutionMode(form.get("executionMode"));

  if (sourceType === "synthetic") {
    const sampleId = requiredString(form, "sampleId");
    const sample = syntheticInvoices.find((candidate) => candidate.id === sampleId);
    if (!sample) {
      throw new MultipartInputError(
        "sample_not_found",
        "Choose one of the available synthetic samples.",
        400,
      );
    }
    const bytes = await container.loadSyntheticDocument(sample.filename);
    const pageCount = await pdfPageCount(bytes);
    const requestedFields = fixedRequestedFields();
    const validation = validateUpload({
      bytes,
      filename: sample.filename,
      reportedType: "application/pdf",
      requestedFields: requestedFields.map((field) => field.label),
      consent: false,
      pageCount,
      sourceType,
    });
    if (!validation.valid) throw validationError(validation.errors[0]);
    return {
      sourceType,
      provider,
      executionMode,
      sample,
      file: {
        filename: sample.filename,
        mediaType: "application/pdf",
        bytes,
        pageCount,
      },
      requestedFields,
      consent: false,
      referenceData: referenceData(sample.id),
    };
  }

  const documentEntry = form.get("document");
  if (!(documentEntry instanceof Blob) || typeof documentEntry.name !== "string") {
    throw new MultipartInputError(
      "document_required",
      "Choose one document to upload.",
      400,
    );
  }
  if (documentEntry.size > MAX_FILE_BYTES) throw validationError("file_too_large");
  const bytes = new Uint8Array(await documentEntry.arrayBuffer());
  const pageCount = looksLikePdf(bytes) ? await pdfPageCount(bytes) : undefined;
  const labels = form
    .getAll("requestedField")
    .filter((value): value is string => typeof value === "string")
    .map(sanitizeFieldLabel);
  const requestedFields = labels.map((label) => ({ key: fieldKey(label), label }));
  const consent = form.get("consent") === "true";
  const filename = sanitizeFilename(documentEntry.name);
  const validation = validateUpload({
    bytes,
    filename,
    reportedType: documentEntry.type,
    requestedFields: labels,
    consent,
    pageCount,
    sourceType,
  });
  if (!validation.valid) throw validationError(validation.errors[0]);

  return {
    sourceType,
    provider,
    executionMode,
    sample: null,
    file: {
      filename,
      mediaType: documentEntry.type,
      bytes,
      ...(pageCount === undefined ? {} : { pageCount }),
    },
    requestedFields,
    consent,
  };
}
