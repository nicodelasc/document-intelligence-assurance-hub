import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { MAX_PDF_PAGES } from "@/domain/file-validation";

export const MAX_GROUNDING_IMAGE_PIXELS = 16_000_000;
export const MAX_GROUNDING_PAGE_TEXT_CHARS = 250_000;
export const DOCUMENT_GROUNDING_TIMEOUT_MS = 20_000;
export const OCR_PAGE_TIMEOUT_MS = 8_000;

const MIN_TEXT_NATIVE_PAGE_CHARS = 12;
const OCR_RENDER_WIDTH = 1_600;
const MAX_IMAGE_EDGE = 8_192;

export type DocumentGroundingInput = {
  bytes: Uint8Array;
  mediaType: string;
  pageCount?: number;
  signal?: AbortSignal;
  visualMode?: "text_or_scan" | "text_and_visual";
};

export type DocumentGrounder = (
  input: DocumentGroundingInput,
) => Promise<string[]>;

export class DocumentGroundingError extends Error {
  readonly name = "DocumentGroundingError";
}

function groundingError(
  code: string,
  options?: ErrorOptions,
): DocumentGroundingError {
  return new DocumentGroundingError(code, options);
}

function abortError(): DOMException {
  return new DOMException("Document grounding aborted", "AbortError");
}

function throwIfGroundingAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function bounded<T>(input: {
  operation: Promise<T>;
  signal?: AbortSignal;
  timeoutMs: number;
  onCancel?: () => void | Promise<void>;
}): Promise<T> {
  throwIfGroundingAborted(input.signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    const cancel = (error: unknown) => {
      void input.onCancel?.();
      reject(error);
    };
    timeout = setTimeout(
      () => cancel(groundingError("document_grounding_timeout")),
      input.timeoutMs,
    );
    timeout.unref?.();
    if (input.signal) {
      abortListener = () => cancel(abortError());
      input.signal.addEventListener("abort", abortListener, { once: true });
    }
  });
  try {
    return await Promise.race([input.operation, cancellation]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (input.signal && abortListener) {
      input.signal.removeEventListener("abort", abortListener);
    }
  }
}

function assertPageText(pages: string[]): string[] {
  if (pages.length < 1 || pages.length > MAX_PDF_PAGES) {
    throw groundingError("document_grounding_page_limit");
  }
  return pages.map((page) => {
    if (page.length > MAX_GROUNDING_PAGE_TEXT_CHARS) {
      throw groundingError("document_grounding_text_limit");
    }
    return page;
  });
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24)
    throw groundingError("document_grounding_image_invalid");
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const segmentLength = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes[offset + 5] * 256 + bytes[offset + 6],
        width: bytes[offset + 7] * 256 + bytes[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }
  throw groundingError("document_grounding_image_invalid");
}

function assertImageAllocation(bytes: Uint8Array, mediaType: string): void {
  const dimensions =
    mediaType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_IMAGE_EDGE ||
    dimensions.height > MAX_IMAGE_EDGE ||
    dimensions.width * dimensions.height > MAX_GROUNDING_IMAGE_PIXELS
  ) {
    throw groundingError("document_grounding_image_limit");
  }
}

async function createLocalOcrWorker() {
  const require = createRequire(import.meta.url);
  const languagePackage = require.resolve("@tesseract.js-data/eng");
  const languagePath = join(dirname(languagePackage), "4.0.0_best_int");
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker("eng", OEM.LSTM_ONLY, {
    cacheMethod: "none",
    gzip: true,
    langPath: languagePath,
  });
}

async function ocrImages(
  images: Uint8Array[],
  signal?: AbortSignal,
): Promise<string[]> {
  let worker: Awaited<ReturnType<typeof createLocalOcrWorker>> | null = null;
  try {
    const workerPromise = createLocalOcrWorker();
    worker = await bounded({
      operation: workerPromise,
      signal,
      timeoutMs: OCR_PAGE_TIMEOUT_MS,
      onCancel: () => {
        void workerPromise
          .then((createdWorker) => createdWorker.terminate())
          .catch(() => undefined);
      },
    });
    const pages: string[] = [];
    for (const image of images) {
      throwIfGroundingAborted(signal);
      const activeWorker = worker;
      const result = await bounded({
        operation: activeWorker.recognize(Buffer.from(image)),
        signal,
        timeoutMs: OCR_PAGE_TIMEOUT_MS,
        onCancel: async () => {
          await activeWorker.terminate();
        },
      });
      pages.push(result.data.text);
    }
    return pages;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw error;
    }
    if (error instanceof DocumentGroundingError) throw error;
    throw groundingError("document_grounding_ocr_failed", { cause: error });
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

async function extractPdfPages(
  input: DocumentGroundingInput,
  registerCancel?: (cancel: () => Promise<void>) => void,
): Promise<string[]> {
  const { extractText, getResolvedPDFJS, renderPageAsImage } = await import(
    "unpdf"
  );
  throwIfGroundingAborted(input.signal);
  const pdfjs = await getResolvedPDFJS();
  throwIfGroundingAborted(input.signal);
  const loadingTask = pdfjs.getDocument({
    data: input.bytes,
    useSystemFonts: true,
    disableFontFace: true,
    maxImageSize: MAX_GROUNDING_IMAGE_PIXELS,
  });
  let destroyPromise: Promise<void> | null = null;
  const destroyPdf = async (): Promise<void> => {
    destroyPromise ??= Promise.resolve(loadingTask.destroy());
    await destroyPromise;
  };
  registerCancel?.(destroyPdf);
  if (input.signal?.aborted) await destroyPdf().catch(() => undefined);
  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    throwIfGroundingAborted(input.signal);
    if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) {
      throw groundingError("document_grounding_page_limit");
    }
    if (input.pageCount !== undefined && input.pageCount !== pdf.numPages) {
      throw groundingError("document_grounding_page_mismatch");
    }
    const extracted = await extractText(pdf, { mergePages: false });
    if (!Array.isArray(extracted.text)) {
      throw groundingError("document_grounding_text_failed");
    }
    const pages = [...extracted.text];
    const visualPageIndexes = pages.flatMap((page, index) =>
      input.visualMode === "text_and_visual" ||
      page.trim().length < MIN_TEXT_NATIVE_PAGE_CHARS
        ? [index]
        : [],
    );
    if (visualPageIndexes.length > 0) {
      const rendered: Uint8Array[] = [];
      for (const pageIndex of visualPageIndexes) {
        throwIfGroundingAborted(input.signal);
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = OCR_RENDER_WIDTH / Math.max(1, viewport.width);
        const renderedWidth = Math.ceil(viewport.width * scale);
        const renderedHeight = Math.ceil(viewport.height * scale);
        if (
          !Number.isFinite(renderedWidth) ||
          !Number.isFinite(renderedHeight) ||
          renderedWidth < 1 ||
          renderedHeight < 1 ||
          renderedWidth > MAX_IMAGE_EDGE ||
          renderedHeight > MAX_IMAGE_EDGE ||
          renderedWidth * renderedHeight > MAX_GROUNDING_IMAGE_PIXELS
        ) {
          throw groundingError("document_grounding_image_limit");
        }
        const image = await renderPageAsImage(pdf, pageIndex + 1, {
          canvasImport: () => import("@napi-rs/canvas"),
          width: renderedWidth,
        });
        if (typeof image === "string") {
          throw groundingError("document_grounding_render_failed");
        }
        rendered.push(new Uint8Array(image));
      }
      const ocrPages = await ocrImages(rendered, input.signal);
      visualPageIndexes.forEach((pageIndex, index) => {
        const ocrText = ocrPages[index] ?? "";
        pages[pageIndex] =
          input.visualMode === "text_and_visual"
            ? [pages[pageIndex], ocrText]
                .filter((pageText) => pageText.trim().length > 0)
                .join("\n")
            : ocrText;
      });
    }
    return assertPageText(pages);
  } finally {
    await Promise.resolve(pdf?.cleanup()).catch(() => undefined);
    await destroyPdf().catch(() => undefined);
  }
}

async function extractDocumentPages(
  input: DocumentGroundingInput,
  registerPdfCancel?: (cancel: () => Promise<void>) => void,
): Promise<string[]> {
  if (input.mediaType === "application/pdf")
    return extractPdfPages(input, registerPdfCancel);
  if (input.mediaType === "image/png" || input.mediaType === "image/jpeg") {
    assertImageAllocation(input.bytes, input.mediaType);
    return assertPageText(await ocrImages([input.bytes], input.signal));
  }
  throw groundingError("document_grounding_format_unsupported");
}

export const groundDocument: DocumentGrounder = async (input) => {
  throwIfGroundingAborted(input.signal);
  const groundingController = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, groundingController.signal])
    : groundingController.signal;
  let cancelPdf: (() => Promise<void>) | null = null;
  try {
    return await bounded({
      operation: extractDocumentPages({ ...input, signal }, (cancel) => {
        cancelPdf = cancel;
        if (signal.aborted) void cancel();
      }),
      signal: input.signal,
      timeoutMs: DOCUMENT_GROUNDING_TIMEOUT_MS,
      onCancel: () => {
        groundingController.abort("document_grounding_cancelled");
        return cancelPdf?.();
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof DocumentGroundingError) throw error;
    throw groundingError("document_grounding_failed", { cause: error });
  }
};

export function normalizeGroundingText(value: string): string {
  if (value.length > MAX_GROUNDING_PAGE_TEXT_CHARS) {
    throw groundingError("document_grounding_text_limit");
  }
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

export function evidenceMapsToPage(input: {
  pages: readonly string[];
  page: number | null;
  evidence: string | null;
}): boolean {
  if (
    input.page === null ||
    input.evidence === null ||
    input.evidence.length > 600 ||
    input.page < 1 ||
    input.page > input.pages.length
  ) {
    return false;
  }
  const evidence = normalizeGroundingText(input.evidence);
  if (!evidence) return false;
  return normalizeGroundingText(input.pages[input.page - 1]).includes(evidence);
}
