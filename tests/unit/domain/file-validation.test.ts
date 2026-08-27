import { describe, expect, it } from "vitest";
import { validateUpload } from "@/domain/file-validation";

const requestedFields = ["Invoice number", "Invoice total"];

function upload(overrides: Partial<Parameters<typeof validateUpload>[0]> = {}) {
  return {
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    filename: "invoice.pdf",
    reportedType: "application/pdf",
    requestedFields,
    consent: true,
    pageCount: 1,
    sourceType: "custom" as const,
    ...overrides,
  };
}

describe("validateUpload", () => {
  it("accepts a PDF with a matching signature and MIME type", () => {
    expect(validateUpload(upload())).toEqual({ valid: true, errors: [] });
  });

  it("accepts PNG and JPEG signatures when their MIME types agree", () => {
    expect(
      validateUpload(
        upload({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          filename: "invoice.png",
          reportedType: "image/png",
        }),
      ),
    ).toEqual({ valid: true, errors: [] });

    expect(
      validateUpload(
        upload({
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
          filename: "invoice.jpg",
          reportedType: "image/jpeg",
        }),
      ),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty, unsupported and MIME-signature-mismatched files", () => {
    expect(validateUpload(upload({ bytes: new Uint8Array() })).errors).toContain("empty_file");
    expect(validateUpload(upload({ bytes: new Uint8Array([0x47, 0x49, 0x46]) })).errors).toContain(
      "unsupported_format",
    );
    expect(validateUpload(upload({ reportedType: "image/png" })).errors).toContain("mime_mismatch");
  });

  it("rejects files exceeding the size and PDF page limits", () => {
    expect(validateUpload(upload({ bytes: new Uint8Array(3 * 1024 * 1024 + 1) })).errors).toContain(
      "file_too_large",
    );
    expect(validateUpload(upload({ pageCount: 6 })).errors).toContain("pdf_page_limit");
  });

  it("requires two or three unique nonblank custom fields and consent", () => {
    expect(validateUpload(upload({ requestedFields: ["Only one"] })).errors).toContain("field_count");
    expect(validateUpload(upload({ requestedFields: ["", "Invoice total"] })).errors).toContain(
      "blank_field",
    );
    expect(
      validateUpload(upload({ requestedFields: ["Invoice Number", " invoice   number "] })).errors,
    ).toContain("duplicate_field");
    expect(validateUpload(upload({ consent: false })).errors).toContain("consent_required");
  });
});
