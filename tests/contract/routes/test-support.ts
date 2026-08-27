import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";
import { InMemoryQuotaRepository } from "@/server/security/rate-limit";
import { InMemoryDocumentStore } from "@/server/storage/document-store";
import { executeRun } from "@/server/workflow/execute-run";
import type { HttpContainer } from "@/server/http/container";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import { InMemoryAbuseControl } from "@/server/security/abuse-control";

let idempotencySequence = 0;

export function createTestContainer(
  overrides: Partial<HttpContainer> = {},
): HttpContainer {
  return {
    repository: new InMemoryRunRepository(),
    quotaRepository: new InMemoryQuotaRepository(),
    documentStore: new InMemoryDocumentStore(),
    abuseControl: new InMemoryAbuseControl(),
    clock: () => new Date("2026-08-27T00:00:00.000Z"),
    requestIdSource: () => "request-test-1",
    bucketTokenSource: () => "test-browser-bucket-token-with-enough-entropy-1234567890",
    replayStageDelayMs: 0,
    liveModeEnabled: false,
    cronSecret: "test-cron-secret",
    execute: executeRun,
    async createProvider(input) {
      if (input.executionMode !== "recorded" || !input.sampleId) {
        throw new Error("test_live_provider_not_injected");
      }
      return createRecordedExtractionProvider({
        provider: input.provider,
        fixtureId: input.sampleId,
      });
    },
    async loadSyntheticDocument(filename) {
      return new Uint8Array(
        await readFile(join(process.cwd(), "public", "samples", filename)),
      );
    },
    ...overrides,
  };
}

export function formRequest(
  entries: Array<[string, string | Blob, string?]>,
  idempotencyKey = `test-idempotency-key-${++idempotencySequence}`,
): Request {
  const form = new FormData();
  for (const [key, value, filename] of entries) {
    if (typeof value === "string") form.append(key, value);
    else form.append(key, value, filename);
  }
  return new Request("http://local.test/api/runs", {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function syntheticRequest(
  sampleId = "clean-match",
  provider = "openai",
  idempotencyKey?: string,
): Request {
  return formRequest([
    ["sourceType", "synthetic"],
    ["provider", provider],
    ["sampleId", sampleId],
    ["executionMode", "recorded"],
  ], idempotencyKey);
}

export function makePdf(pageCount: number): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from(
      { length: pageCount },
      (_, index) => `${index + 3} 0 R`,
    ).join(" ")}] >>`,
    ...Array.from(
      { length: pageCount },
      () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    ),
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = source.length;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(source);
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function readLines(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}
