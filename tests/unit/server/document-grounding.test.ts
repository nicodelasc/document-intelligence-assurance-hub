import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  DocumentGroundingError,
  evidenceMapsToPage,
  groundDocument,
} from "@/server/workflow/document-grounding";

describe("document grounding", () => {
  it("extracts page-scoped text from a real text-native PDF", async () => {
    const bytes = new Uint8Array(
      await readFile(
        join(process.cwd(), "public", "samples", "clean-match-invoice.pdf"),
      ),
    );

    const pages = await groundDocument({
      bytes,
      mediaType: "application/pdf",
      pageCount: 1,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("PO-NP-1001");
    expect(pages[0]).toContain("1250.00 SGD");
  });

  it("uses local OCR when a PDF page contains only a scanned image", async () => {
    const canvas = createCanvas(1200, 280);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 1200, 280);
    context.fillStyle = "black";
    context.font = "64px sans-serif";
    context.fillText("TOTAL 1250.00 SGD", 60, 170);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(canvas.toBuffer("image/png"));
    const page = pdf.addPage([1200, 280]);
    page.drawImage(image, { x: 0, y: 0, width: 1200, height: 280 });

    const pages = await groundDocument({
      bytes: new Uint8Array(await pdf.save()),
      mediaType: "application/pdf",
      pageCount: 1,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatch(/TOTAL[\s\S]*SGD/i);
  }, 30_000);

  it("rejects an oversized declared image before OCR allocation", async () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0x00, 0x00, 0x27, 0x10], 16);
    bytes.set([0x00, 0x00, 0x27, 0x10], 20);

    await expect(
      groundDocument({ bytes, mediaType: "image/png" }),
    ).rejects.toMatchObject<DocumentGroundingError>({
      name: "DocumentGroundingError",
      message: "document_grounding_image_limit",
    });
  });

  it("honors an already-aborted workflow before parsing", async () => {
    const controller = new AbortController();
    controller.abort("reviewer_left");

    await expect(
      groundDocument({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        mediaType: "application/pdf",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("requires one normalized evidence string to remain a contiguous page span", () => {
    const pages = [
      "Supplier:\u00a0Northstar   Paperworks\nPO: PO\u2011NP\u20111001",
    ];

    expect(
      evidenceMapsToPage({
        pages,
        page: 1,
        evidence: "Supplier: Northstar Paperworks",
      }),
    ).toBe(true);
    expect(
      evidenceMapsToPage({
        pages,
        page: 1,
        evidence: "Supplier: approved Northstar Paperworks",
      }),
    ).toBe(false);
  });
});
