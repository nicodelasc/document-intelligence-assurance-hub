import { validateUpload } from "../../src/domain/file-validation";

// @ts-expect-error sourceType must make the synthetic or custom policy explicit.
validateUpload({
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  filename: "invoice.pdf",
  reportedType: "application/pdf",
  requestedFields: ["Invoice number", "Invoice total"],
  consent: true,
});
