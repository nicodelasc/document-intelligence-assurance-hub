import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unpdfMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  destroy: vi.fn(),
  extractText: vi.fn(),
  getDocument: vi.fn(),
  getPage: vi.fn(),
  renderPageAsImage: vi.fn(),
}));

vi.mock("unpdf", () => ({
  extractText: unpdfMocks.extractText,
  getResolvedPDFJS: async () => ({ getDocument: unpdfMocks.getDocument }),
  renderPageAsImage: unpdfMocks.renderPageAsImage,
}));

import {
  DOCUMENT_GROUNDING_TIMEOUT_MS,
  groundDocument,
} from "@/server/workflow/document-grounding";

describe("PDF grounding cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(unpdfMocks).forEach((mock) => mock.mockReset());
    unpdfMocks.cleanup.mockResolvedValue(undefined);
    unpdfMocks.destroy.mockResolvedValue(undefined);
    unpdfMocks.getPage.mockResolvedValue({
      getViewport: () => ({ width: 800, height: 1_000 }),
    });
    unpdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        cleanup: unpdfMocks.cleanup,
        getPage: unpdfMocks.getPage,
      }),
      destroy: unpdfMocks.destroy,
    });
    unpdfMocks.extractText.mockResolvedValue({ text: [""] });
    unpdfMocks.renderPageAsImage.mockImplementation(
      () => new Promise<ArrayBuffer>(() => undefined),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroys active PDF work when the document timeout fires", async () => {
    const grounding = groundDocument({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mediaType: "application/pdf",
      pageCount: 1,
    });
    const rejection = expect(grounding).rejects.toMatchObject({
      name: "DocumentGroundingError",
      message: "document_grounding_timeout",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(unpdfMocks.renderPageAsImage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DOCUMENT_GROUNDING_TIMEOUT_MS);
    await rejection;

    expect(unpdfMocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("owns and destroys the PDF loading task before its proxy resolves", async () => {
    unpdfMocks.getDocument.mockReturnValueOnce({
      promise: new Promise(() => undefined),
      destroy: unpdfMocks.destroy,
    });
    const grounding = groundDocument({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mediaType: "application/pdf",
      pageCount: 1,
    });
    const rejection = expect(grounding).rejects.toMatchObject({
      name: "DocumentGroundingError",
      message: "document_grounding_timeout",
    });

    await vi.advanceTimersByTimeAsync(DOCUMENT_GROUNDING_TIMEOUT_MS);
    await rejection;

    expect(unpdfMocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the PDF loading task when proxy creation rejects", async () => {
    unpdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("malformed_pdf")),
      destroy: unpdfMocks.destroy,
    });

    await expect(
      groundDocument({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        mediaType: "application/pdf",
        pageCount: 1,
      }),
    ).rejects.toMatchObject({
      name: "DocumentGroundingError",
      message: "document_grounding_failed",
    });

    expect(unpdfMocks.destroy).toHaveBeenCalledTimes(1);
  });
});
