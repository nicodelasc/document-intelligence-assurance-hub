import { describe, expect, it } from "vitest";
import type { FieldResult, Provider } from "@/domain/types";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";
import { InMemoryQuotaRepository } from "@/server/security/rate-limit";
import { deleteRunNow, hashDeletionToken } from "@/server/security/deletion-token";
import { InMemoryDocumentStore } from "@/server/storage/document-store";
import {
  executeRun,
  type ExecuteRunDependencies,
  type FieldEvaluator,
} from "@/server/workflow/execute-run";
import {
  ProviderRequestError,
  type ExtractionProvider,
  type ProviderExtractionResponse,
} from "@/server/workflow/provider";

const requestedFields = [
  { key: "vendor_name", label: "Vendor name" },
  { key: "purchase_order_number", label: "Purchase-order number" },
  { key: "invoice_total", label: "Invoice total" },
];

const extraction: ProviderExtractionResponse = {
  extraction: {
    fields: [
      {
        key: "vendor_name",
        label: "Vendor name",
        extractedValue: "Northstar Paperworks",
        normalizedValue: "Northstar Paperworks",
        evidence: "Supplier: Northstar Paperworks",
        page: 1,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: "PO-NP-1001",
        normalizedValue: "PO-NP-1001",
        evidence: "PO: PO-NP-1001",
        page: 1,
      },
      {
        key: "invoice_total",
        label: "Invoice total",
        extractedValue: "1250.00 SGD",
        normalizedValue: "1250.00 SGD",
        evidence: "Total due: 1250.00 SGD",
        page: 1,
      },
    ],
  },
  usage: { inputTokens: 100, outputTokens: 25 },
  latencyMs: 300,
};

function provider(input: {
  name?: Provider;
  executionMode?: "recorded" | "live";
  extract?: ExtractionProvider["extract"];
} = {}): ExtractionProvider {
  return {
    provider: input.name ?? "openai",
    model: input.name === "anthropic" ? "claude-haiku-4-5" : "gpt-5-mini",
    promptVersion: "test-prompt.v1",
    executionMode: input.executionMode ?? "live",
    extract: input.extract ?? (async () => extraction),
  };
}

function clock(start = Date.parse("2026-08-27T00:00:00.000Z")): () => Date {
  let tick = start;
  return () => new Date(tick++);
}

function dependencies(selectedProvider: ExtractionProvider, evaluator?: FieldEvaluator) {
  const repository = new InMemoryRunRepository();
  const documentStore = new InMemoryDocumentStore();
  const value: ExecuteRunDependencies = {
    repository,
    documentStore,
    provider: selectedProvider,
    clock: clock(),
    idSource: () => "run-123",
    deletionCredentialSource: () => ({
      token: "delete-once",
      hash: hashDeletionToken("delete-once"),
    }),
    evaluateField: evaluator,
    sleep: async () => undefined,
  };
  return { value, repository, documentStore };
}

const input = {
  sourceType: "synthetic" as const,
  file: {
    filename: "clean-match-invoice.pdf",
    mediaType: "application/pdf",
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    pageCount: 1,
  },
  requestedFields,
  consent: false,
  referenceData: {
    vendor_name: "Northstar Paperworks",
    purchase_order_number: "PO-NP-1001",
    invoice_total: "1250.00 SGD",
  },
};

async function collect(inputValue: typeof input, deps: ExecuteRunDependencies) {
  const events = [];
  for await (const event of executeRun(inputValue, deps)) events.push(event);
  return events;
}

describe("executeRun", () => {
  it.each([429, 500, 503])("retries HTTP %s once then completes with the selected provider", async (status) => {
    let attempts = 0;
    const selected = provider({
      extract: async () => {
        attempts += 1;
        if (attempts === 1) throw new ProviderRequestError("provider_unavailable", status);
        return extraction;
      },
    });
    const { value, repository } = dependencies(selected);

    const events = await collect(input, value);
    expect(attempts).toBe(2);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      outcome: "clear",
      runId: "run-123",
      deletionToken: "delete-once",
    });
    expect((await repository.readPublicRun("run-123", new Date("2026-08-27T01:00:00.000Z")))?.provider).toBe(
      "openai",
    );
  });

  it.each([400, 401, 403, 422, 600])(
    "does not retry non-retryable HTTP %s provider failures",
    async (status) => {
    let attempts = 0;
    const selected = provider({
      extract: async () => {
        attempts += 1;
        throw new ProviderRequestError("provider_request_rejected", status);
      },
    });
    const { value, repository } = dependencies(selected);

    const events = await collect(input, value);
    expect(attempts).toBe(1);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "failed",
        code: "provider_request_rejected",
        deletionToken: "delete-once",
      }),
    );
    const publicRun = await repository.readPublicRun("run-123", new Date("2026-08-27T01:00:00.000Z"));
      expect(publicRun).toMatchObject({
        provider: "openai",
        status: "failed",
        retryCount: 0,
        latencyMs: expect.any(Number),
        stepDurations: { extracting: expect.any(Number) },
      });
    },
  );

  it("stops after one retry and never switches away from the selected provider", async () => {
    let openAIAttempts = 0;
    const selected = provider({
      name: "openai",
      extract: async () => {
        openAIAttempts += 1;
        throw new ProviderRequestError("provider_unavailable", 503);
      },
    });
    const { value, repository, documentStore } = dependencies(selected);

    const events = await collect(input, value);
    expect(openAIAttempts).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "provider_unavailable" });
    expect(
      await repository.readPublicRun("run-123", new Date("2026-08-27T01:00:00.000Z")),
    ).toMatchObject({
      provider: "openai",
      status: "failed",
      retryCount: 1,
      latencyMs: expect.any(Number),
      stepDurations: { extracting: expect.any(Number) },
    });
    await expect(
      deleteRunNow({
        repository,
        documentStore,
        runId: "run-123",
        token: "delete-once",
        now: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ).resolves.toBe("deleted");
  });

  it("runs field evaluators concurrently while emitting field events in requested order", async () => {
    const releases = new Map<string, () => void>();
    const completionOrder: string[] = [];
    let started = 0;
    let signalAllStarted = () => undefined;
    const allStarted = new Promise<void>((resolve) => {
      signalAllStarted = resolve;
    });
    const evaluator: FieldEvaluator = async ({ extractedField }) => {
      started += 1;
      if (started === requestedFields.length) signalAllStarted();
      await new Promise<void>((resolve) => releases.set(extractedField.key, resolve));
      completionOrder.push(extractedField.key);
      return {
        ...extractedField,
        evaluatorStatus: "pass",
        referenceMatch: null,
      } satisfies FieldResult;
    };
    const { value } = dependencies(provider(), evaluator);

    const eventsPromise = collect(input, value);
    await allStarted;
    releases.get("invoice_total")?.();
    await Promise.resolve();
    releases.get("vendor_name")?.();
    await Promise.resolve();
    releases.get("purchase_order_number")?.();
    const events = await eventsPromise;

    expect(completionOrder).toEqual(["invoice_total", "vendor_name", "purchase_order_number"]);
    expect(events.filter((event) => event.type === "field").map((event) => event.field.key)).toEqual(
      requestedFields.map((field) => field.key),
    );
    expect(events.filter((event) => event.type === "stage").map((event) => event.stage)).toEqual([
      "validating",
      "storing",
      "extracting",
      "verifying",
      "comparing",
      "deciding",
      "publishing",
    ]);
  });

  it("uses a bounded injectable delay for visibly progressive recorded replay stages", async () => {
    const delays: number[] = [];
    const { value } = dependencies(provider({ executionMode: "recorded" }));
    value.replayStageDelayMs = 10_000;
    value.sleep = async (delayMs) => {
      delays.push(delayMs);
    };

    await collect(input, value);
    expect(delays.length).toBeGreaterThan(1);
    expect(delays.every((delay) => delay === 500)).toBe(true);
  });

  it("excludes recorded replay presentation sleeps from processing telemetry", async () => {
    const startedAt = Date.parse("2026-08-27T00:00:00.000Z");
    let presentationTimeMs = 0;
    let processingTimeMs = 0;
    const { value, repository } = dependencies(provider({ executionMode: "recorded" }));
    value.clock = () => new Date(startedAt + presentationTimeMs);
    value.processingClock = () => {
      processingTimeMs += 5;
      return processingTimeMs;
    };
    value.replayStageDelayMs = 500;
    value.sleep = async () => {
      presentationTimeMs += 10_000;
    };

    await collect(input, value);

    const run = await repository.readPublicRun(
      "run-123",
      new Date("2026-08-27T01:00:00.000Z"),
    );
    expect(run?.latencyMs).toBeLessThan(500);
    expect(Math.max(...Object.values(run?.stepDurations ?? {}))).toBeLessThan(100);
  });

  it("turns a raw persistence failure into one stable safe terminal event", async () => {
    class FailingRepository extends InMemoryRunRepository {
      override async createRun(): Promise<void> {
        throw new Error("DATABASE_URL=must-not-leak");
      }
    }
    const { value } = dependencies(provider());
    value.repository = new FailingRepository();

    const events = await collect(input, value);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "telemetry_unavailable",
      message: "The run could not be recorded safely.",
    });
    expect(events.at(-1)).not.toHaveProperty("deletionToken");
    expect(JSON.stringify(events)).not.toContain("DATABASE_URL");
  });

  it("still emits the provider-safe terminal event when failure telemetry cannot be written", async () => {
    class FailingFailureWriteRepository extends InMemoryRunRepository {
      override async markFailed(): Promise<void> {
        throw new Error("database-debug-payload");
      }
    }
    const selected = provider({
      extract: async () => {
        throw new ProviderRequestError("provider_request_rejected", 400);
      },
    });
    const { value } = dependencies(selected);
    value.repository = new FailingFailureWriteRepository();

    const events = await collect(input, value);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "provider_request_rejected" });
    expect(JSON.stringify(events)).not.toContain("database-debug-payload");
  });

  it("returns the one-time deletion token when storage fails after run creation", async () => {
    class FailingDocumentStore extends InMemoryDocumentStore {
      override async storePrivateDocument(): Promise<never> {
        throw new Error("blob-debug-payload");
      }
    }
    const { value, repository } = dependencies(provider());
    value.documentStore = new FailingDocumentStore();

    const events = await collect(input, value);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "storage_unavailable",
      runId: "run-123",
      deletionToken: "delete-once",
    });
    expect(JSON.stringify(events)).not.toContain("blob-debug-payload");
    await expect(
      deleteRunNow({
        repository,
        documentStore: value.documentStore,
        runId: "run-123",
        token: "delete-once",
        now: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ).resolves.toBe("deleted");
    await expect(
      deleteRunNow({
        repository,
        documentStore: value.documentStore,
        runId: "run-123",
        token: "delete-once",
        now: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ).resolves.toBe("not_found");
  });

  it("settles actual live cost once against a conservative quota reservation", async () => {
    const quotas = new InMemoryQuotaRepository(3, () => "quota-success");
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now: new Date("2026-08-27T00:00:00.000Z"),
    });
    expect(reservation).toMatchObject({ allowed: true, reservationId: "quota-success" });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("reservation_missing");
    const { value } = dependencies(provider());
    value.quotaReservation = { repository: quotas, reservationId: reservation.reservationId };

    await collect(input, value);

    const snapshot = await quotas.snapshot(new Date("2026-08-27T01:00:00.000Z"));
    expect(snapshot.globalSpendUsd).toBeCloseTo(0.000075, 9);
    expect(snapshot.reservedSpendUsd).toBe(0);
    await expect(quotas.settleLiveReservation("quota-success", 2)).resolves.toEqual({
      status: "already_settled",
      actualCostUsd: 0.000075,
    });
  });

  it("releases a pending quota reservation when a live provider fails", async () => {
    const quotas = new InMemoryQuotaRepository(3, () => "quota-failure");
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now: new Date("2026-08-27T00:00:00.000Z"),
    });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("reservation_missing");
    const { value } = dependencies(
      provider({
        extract: async () => {
          throw new ProviderRequestError("provider_request_rejected", 400);
        },
      }),
    );
    value.quotaReservation = { repository: quotas, reservationId: reservation.reservationId };

    await collect(input, value);

    await expect(quotas.snapshot(new Date("2026-08-27T01:00:00.000Z"))).resolves.toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 0,
    });
  });

  it("keeps a conservative reservation when actual-cost settlement cannot be confirmed", async () => {
    class SettlementUnavailableQuotaRepository extends InMemoryQuotaRepository {
      override async settleLiveReservation(): Promise<never> {
        throw new Error("quota-database-unavailable");
      }
    }
    const quotas = new SettlementUnavailableQuotaRepository(3, () => "quota-uncertain");
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now: new Date("2026-08-27T00:00:00.000Z"),
    });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("reservation_missing");
    const { value } = dependencies(provider());
    value.quotaReservation = { repository: quotas, reservationId: reservation.reservationId };

    const events = await collect(input, value);

    expect(events.at(-1)).toMatchObject({ type: "failed", code: "workflow_failed" });
    await expect(quotas.snapshot(new Date("2026-08-27T01:00:00.000Z"))).resolves.toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 1,
    });
    expect(JSON.stringify(events)).not.toContain("quota-database-unavailable");
  });

  it("replaces equivalent provider normalization with a server-owned canonical value", async () => {
    const response = structuredClone(extraction);
    response.extraction.fields[2].normalizedValue = "S$1,250";
    const { value } = dependencies(provider({ extract: async () => response }));

    const events = await collect(input, value);

    const total = events.find(
      (event) => event.type === "field" && event.field.key === "invoice_total",
    );
    expect(total).toMatchObject({
      type: "field",
      field: {
        normalizedValue: "1250.00 SGD",
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "clear" });
  });

  it("cannot false-clear when provider normalization contradicts extraction and evidence", async () => {
    const response = structuredClone(extraction);
    response.extraction.fields[2].normalizedValue = "999.00 SGD";
    const { value } = dependencies(provider({ extract: async () => response }));

    const events = await collect(input, value);

    expect(
      events.find((event) => event.type === "field" && event.field.key === "invoice_total"),
    ).toMatchObject({
      type: "field",
      field: {
        normalizedValue: "1250.00 SGD",
        evaluatorStatus: "conflict",
        referenceMatch: true,
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "needs_review" });
  });

  it("cannot false-clear when extracted value and evidence contradict each other", async () => {
    const response = structuredClone(extraction);
    response.extraction.fields[2].evidence = "Total due: 999.00 SGD";
    const { value } = dependencies(provider({ extract: async () => response }));

    const events = await collect(input, value);

    expect(
      events.find((event) => event.type === "field" && event.field.key === "invoice_total"),
    ).toMatchObject({
      type: "field",
      field: { evaluatorStatus: "conflict", referenceMatch: true },
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "needs_review" });
  });

  it("does not treat an unrelated invoice number as total evidence", async () => {
    const response = structuredClone(extraction);
    response.extraction.fields[2] = {
      ...response.extraction.fields[2],
      extractedValue: "100.00 SGD",
      normalizedValue: "100.00 SGD",
      evidence: "Invoice 100; total 999.00 SGD",
    };
    const totalInput = {
      ...input,
      referenceData: { ...input.referenceData, invoice_total: "100.00 SGD" },
    };
    const { value } = dependencies(provider({ extract: async () => response }));

    const events = await collect(totalInput, value);

    expect(
      events.find((event) => event.type === "field" && event.field.key === "invoice_total"),
    ).toMatchObject({ type: "field", field: { evaluatorStatus: "conflict" } });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "needs_review" });
  });

  it("requires identifier evidence to match a complete canonical token", async () => {
    const response = structuredClone(extraction);
    response.extraction.fields[1] = {
      ...response.extraction.fields[1],
      extractedValue: "123",
      normalizedValue: "123",
      evidence: "Purchase order reference: 91234",
    };
    const identifierInput = {
      ...input,
      referenceData: { ...input.referenceData, purchase_order_number: "123" },
    };
    const { value } = dependencies(provider({ extract: async () => response }));

    const events = await collect(identifierInput, value);

    expect(
      events.find(
        (event) => event.type === "field" && event.field.key === "purchase_order_number",
      ),
    ).toMatchObject({ type: "field", field: { evaluatorStatus: "conflict" } });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "needs_review" });
  });

  it("performs reference matching after the announced comparison stage and flags mismatch", async () => {
    const mismatchedInput = {
      ...input,
      referenceData: { ...input.referenceData, invoice_total: "1300.00 SGD" },
    };
    const { value } = dependencies(provider());

    const events = await collect(mismatchedInput, value);
    const comparisonIndex = events.findIndex(
      (event) => event.type === "stage" && event.stage === "comparing",
    );
    const totalIndex = events.findIndex(
      (event) => event.type === "field" && event.field.key === "invoice_total",
    );

    expect(comparisonIndex).toBeGreaterThan(-1);
    expect(totalIndex).toBeGreaterThan(comparisonIndex);
    expect(events[totalIndex]).toMatchObject({
      type: "field",
      field: { evaluatorStatus: "conflict", referenceMatch: false },
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "needs_review" });
  });
});
