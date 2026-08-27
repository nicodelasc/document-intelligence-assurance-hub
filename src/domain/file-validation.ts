import type { UploadValidation, UploadValidationError } from "./types";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_PDF_PAGES = 5;

type SupportedFormat = "pdf" | "png" | "jpeg";

function detectFormat(bytes: Uint8Array): SupportedFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function expectedMime(format: SupportedFormat): string {
  return format === "pdf" ? "application/pdf" : format === "png" ? "image/png" : "image/jpeg";
}

function normalizedLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function validateUpload(input: {
  bytes: Uint8Array;
  filename: string;
  reportedType: string;
  requestedFields: string[];
  consent: boolean;
  pageCount?: number;
  sourceType?: "synthetic" | "custom";
}): UploadValidation {
  const errors: UploadValidationError[] = [];
  const format = detectFormat(input.bytes);

  if (input.bytes.length === 0) errors.push("empty_file");
  if (input.bytes.length > MAX_FILE_BYTES) errors.push("file_too_large");
  if (!format && input.bytes.length > 0) errors.push("unsupported_format");
  if (format && input.reportedType !== expectedMime(format)) errors.push("mime_mismatch");
  if (format === "pdf" && (input.pageCount ?? 1) > MAX_PDF_PAGES) errors.push("pdf_page_limit");

  if ((input.sourceType ?? "custom") === "custom") {
    if (input.requestedFields.length < 2 || input.requestedFields.length > 3) errors.push("field_count");

    const labels = input.requestedFields.map(normalizedLabel);
    if (labels.some((label) => !label)) errors.push("blank_field");
    if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length) errors.push("duplicate_field");
    if (!input.consent) errors.push("consent_required");
  }

  return { valid: errors.length === 0, errors };
}
