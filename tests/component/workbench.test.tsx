// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComparisonLedger,
  CustomUploadFields,
  ProviderSelector,
} from "@/components/workbench/workbench-controls";
import { consumeNdjson } from "@/components/workbench/run-stream";
import { WorkbenchView } from "@/components/workbench/workbench-view";
import type { FieldResult, RunEvent } from "@/domain/types";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function ndjson(events: RunEvent[]): Response {
  return new Response(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function field(key: string, extractedValue: string, normalizedValue: string): FieldResult {
  return {
    key,
    label: key === "vendor" ? "Vendor" : "Total",
    extractedValue,
    normalizedValue,
    evidence: `Evidence for ${extractedValue}`,
    page: 1,
    evaluatorStatus: "pass",
    referenceMatch: null,
  };
}

const emptyHistory = () => new Response(JSON.stringify({ runs: [], pagination: { limit: 12, offset: 0, returned: 0 } }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("Workbench controls", () => {
  it("starts custom consent unchecked and keeps exactly two or three field labels", async () => {
    const user = userEvent.setup();
    render(<CustomUploadFields onReadyChange={() => undefined} />);

    expect(screen.getByRole("checkbox", { name: /publicly visible/i })).not.toBeChecked();
    expect(screen.getAllByRole("textbox", { name: /review field/i })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /add a third field/i }));
    expect(screen.getAllByRole("textbox", { name: /review field/i })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /add a third field/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove third field/i }));
    expect(screen.getAllByRole("textbox", { name: /review field/i })).toHaveLength(2);
  });

  it("focuses the first invalid custom control", async () => {
    const user = userEvent.setup();
    render(<CustomUploadFields onReadyChange={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /validate custom upload/i }));
    expect(screen.getByLabelText(/document file/i)).toHaveFocus();
  });

  it("lets a keyboard user select either provider", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProviderSelector value="openai" onChange={onChange} />);

    const anthropic = screen.getByRole("radio", { name: /anthropic claude haiku 4.5/i });
    anthropic.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("anthropic");
  });
});

describe("NDJSON streaming", () => {
  it("parses split lines in stage order and announces completion", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"stage","stage":"validating","timestamp":"2026-08-27T00:00:00.000Z"}\n{"type":"stage","stage":"storing",',
      '"timestamp":"2026-08-27T00:00:00.100Z"}\n{"type":"completed","outcome":"clear","runId":"run_a","executionMode":"recorded","deletionToken":"private_once","timestamp":"2026-08-27T00:00:00.200Z"}\n',
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      }),
    );
    const seen: string[] = [];

    const terminal = await consumeNdjson(response, {
      onEvent: (event) => seen.push(event.type === "stage" ? event.stage : event.type),
    });

    expect(seen).toEqual(["validating", "storing", "completed"]);
    expect(terminal).toMatchObject({ type: "completed", runId: "run_a" });
  });
});

describe("Comparison ledger", () => {
  const runs = [
    {
      id: "run_a",
      provider: "openai" as const,
      model: "gpt-5-mini",
      executionMode: "recorded" as const,
      requestedFields: ["Vendor name"],
      values: ["Northstar Paperworks"],
      evidence: ["Supplier: Northstar Paperworks"],
      evaluator: ["pass"],
      latencyMs: 120,
      outcome: "clear" as const,
    },
    {
      id: "run_b",
      provider: "anthropic" as const,
      model: "claude-haiku-4.5",
      executionMode: "recorded" as const,
      requestedFields: ["Vendor name"],
      values: ["Northstar Paperworks"],
      evidence: ["Supplier: Northstar Paperworks"],
      evaluator: ["pass"],
      latencyMs: 140,
      outcome: "clear" as const,
    },
  ];

  it("requires two distinct runs", () => {
    render(<ComparisonLedger runs={runs} leftId="run_a" rightId="run_a" />);
    expect(screen.getByText(/choose two distinct runs/i)).toBeInTheDocument();
  });

  it("renders every required comparison dimension", () => {
    render(<ComparisonLedger runs={runs} leftId="run_a" rightId="run_b" />);
    for (const label of [
      "Requested fields",
      "Extracted and normalized values",
      "Evidence",
      "Provider and model",
      "Execution mode",
      "Evaluator status",
      "Latency",
      "Outcome",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("Custom document validation", () => {
  it("rejects an unsupported picker file before readiness", async () => {
    const user = userEvent.setup();
    const onReadyChange = vi.fn();
    render(<CustomUploadFields onReadyChange={onReadyChange} />);

    fireEvent.change(screen.getByLabelText("Document file"), {
      target: { files: [new File(["plain text"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByText("Upload a PDF, PNG or JPG document.");
    await user.click(screen.getByRole("button", { name: "Validate custom upload" }));

    expect(screen.getByText("Upload a PDF, PNG or JPG document.")).toBeVisible();
    expect(screen.getByLabelText("Document file")).toHaveFocus();
    expect(onReadyChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
  });

  it("rejects an oversized dropped file at the server cap", async () => {
    render(<CustomUploadFields onReadyChange={() => undefined} />);
    const oversized = new File(
      [new Uint8Array(3 * 1024 * 1024 + 1)],
      "too-large.png",
      { type: "image/png" },
    );
    fireEvent.drop(screen.getByText(/Drop one file here/i).closest(".drop-zone")!, {
      dataTransfer: { files: [oversized] },
    });
    await screen.findByText("The document must be 3 MB or smaller.");
    expect(screen.getByLabelText("Document file")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a PDF with more than five pages before submit", async () => {
    const document = await PDFDocument.create();
    for (let index = 0; index < 6; index += 1) document.addPage();
    const bytes = await document.save();
    const user = userEvent.setup();
    render(<CustomUploadFields onReadyChange={() => undefined} />);

    await user.upload(
      screen.getByLabelText("Document file"),
      new File([bytes], "six-pages.pdf", { type: "application/pdf" }),
    );

    expect(await screen.findByText("PDF documents must contain no more than five pages.")).toBeVisible();
  });

  it("submit validates then focuses the first actually invalid field", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => emptyHistory()));
    render(<WorkbenchView />);
    await user.click(screen.getByText("Custom upload", { exact: true }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Vendor");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));

    await user.click(screen.getByRole("button", { name: "Run assurance check" }));

    expect(screen.getByLabelText("Review field 2")).toHaveFocus();
    expect(screen.getByText("Field labels must be unique.")).toBeVisible();
  });
});

describe("Workbench request lifecycle", () => {
  it("sends custom preflight metadata with a failed terminal event", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return emptyHistory();
      return ndjson([{
        type: "failed",
        code: "provider_unavailable",
        message: "The selected provider is temporarily unavailable.",
        runId: "run_failed_receipt",
        deletionToken: "failed_delete_once",
        timestamp: "2026-08-27T00:00:01.000Z",
      }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);
    await user.click(screen.getByText("Custom upload", { exact: true }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));
    await user.click(screen.getByRole("button", { name: "Run assurance check" }));

    expect(await screen.findByText("failed_delete_once")).toBeVisible();
    expect(localStorage.getItem("assurance-delete:run_failed_receipt")).toContain("failed_delete_once");
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(new Headers(postCall?.[1]?.headers).get("idempotency-key")).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/,
    );
    expect(new Headers(postCall?.[1]?.headers).get("x-run-source-type")).toBe(
      "custom",
    );
    expect(new Headers(postCall?.[1]?.headers).get("x-run-execution-mode")).toBe(
      "live",
    );
  });

  it("renders untrusted field labels and evidence only as text", async () => {
    const user = userEvent.setup();
    const hostileLabel = '<img data-private-payload="field" src=x>';
    const hostileEvidence = '<script data-private-payload="evidence">alert(1)</script>';
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return emptyHistory();
        return ndjson([
          {
            type: "field",
            field: {
              ...field("vendor", "Northstar Paperworks", "Northstar Paperworks"),
              label: hostileLabel,
              evidence: hostileEvidence,
            },
            timestamp: "2026-08-27T00:00:00.000Z",
          },
          {
            type: "completed",
            outcome: "clear",
            runId: "run_text_only",
            executionMode: "recorded",
            deletionToken: "text_only_delete_token",
            timestamp: "2026-08-27T00:00:01.000Z",
          },
        ]);
      }),
    );
    const view = render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Run assurance check" }));

    expect(await screen.findByText(hostileLabel)).toBeVisible();
    expect(screen.getByText(hostileEvidence)).toBeVisible();
    expect(view.container.querySelector("[data-private-payload]")).toBeNull();
  });

  it("restores every unexpired receipt then deletes one without removing another", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    localStorage.setItem("assurance-delete:run_restore_a", JSON.stringify({ token: "restore_token_a", expiresAt }));
    localStorage.setItem("assurance-delete:run_restore_b", JSON.stringify({ token: "restore_token_b", expiresAt }));
    localStorage.setItem("assurance-delete:run_expired", JSON.stringify({ token: "expired_token", expiresAt: "2020-01-01T00:00:00.000Z" }));
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(JSON.stringify({ deletion: { status: "accepted" } }), { status: 202 });
      return emptyHistory();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    expect(await screen.findByText("restore_token_a")).toBeVisible();
    expect(screen.getByText("restore_token_b")).toBeVisible();
    expect(screen.queryByText("expired_token")).not.toBeInTheDocument();
    expect(localStorage.getItem("assurance-delete:run_expired")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete run run_restore_a" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("restore_token_a");
    expect(dialog).not.toHaveTextContent("hash");
    await user.click(within(dialog).getByRole("button", { name: "Delete now" }));

    await waitFor(() => expect(screen.queryByText("restore_token_a")).not.toBeInTheDocument());
    expect(screen.getByText("restore_token_b")).toBeVisible();
    expect(localStorage.getItem("assurance-delete:run_restore_a")).toBeNull();
    expect(localStorage.getItem("assurance-delete:run_restore_b")).toContain("restore_token_b");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run_restore_a", expect.objectContaining({
      method: "DELETE",
      headers: { "x-delete-token": "restore_token_a" },
    }));
  });

  it("isolates streamed fields per custom run then focuses the final outcome", async () => {
    const user = userEvent.setup();
    const terminals = [
      ndjson([
        { type: "field", field: field("vendor", "Alpha raw", "Alpha normalized"), timestamp: "2026-08-27T00:00:00.000Z" },
        { type: "completed", outcome: "evidence_consistent", runId: "run_custom_a", executionMode: "live", deletionToken: "token_a", timestamp: "2026-08-27T00:00:01.000Z" },
      ]),
      ndjson([
        { type: "field", field: field("total", "Beta raw", "Beta normalized"), timestamp: "2026-08-27T00:00:02.000Z" },
        { type: "completed", outcome: "not_found", runId: "run_custom_b", executionMode: "live", deletionToken: "token_b", timestamp: "2026-08-27T00:00:03.000Z" },
      ]),
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return emptyHistory();
      return terminals.shift()!;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);
    await user.click(screen.getByText("Custom upload", { exact: true }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));

    await user.click(screen.getByRole("button", { name: "Run assurance check" }));
    expect(await screen.findByRole("heading", { name: "Evidence-consistent" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Run assurance check" }));
    expect(await screen.findByRole("heading", { name: "Not found" })).toHaveFocus();

    await user.selectOptions(screen.getByLabelText("Run A"), "run_custom_a");
    await user.selectOptions(screen.getByLabelText("Run B"), "run_custom_b");
    const comparison = screen.getByRole("table", { name: /comparison of two assurance runs/i });
    expect(comparison).toHaveTextContent("Extracted: Alpha raw · Normalized: Alpha normalized");
    expect(comparison).toHaveTextContent("Extracted: Beta raw · Normalized: Beta normalized");
    expect(comparison).toHaveTextContent("Evidence for Alpha raw");
    expect(comparison).toHaveTextContent("Evidence for Beta raw");
    expect(comparison).not.toHaveTextContent("Northstar Paperworks");
  });

  it("aborts the active request when Workbench unmounts", async () => {
    const user = userEvent.setup();
    let activeSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Promise.resolve(emptyHistory());
      activeSignal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<WorkbenchView />);
    await user.click(screen.getByRole("button", { name: "Run assurance check" }));
    await waitFor(() => expect(activeSignal).toBeDefined());

    view.unmount();

    expect(activeSignal?.aborted).toBe(true);
  });
});

describe("Public run history", () => {
  it("hydrates bounded active details after refresh for complete comparison", async () => {
    const publicRuns = ["public_a", "public_b"].map((id, index) => ({
      id,
      provider: index === 0 ? "openai" : "anthropic",
      model: index === 0 ? "gpt-5-mini" : "claude-haiku-4.5",
      executionMode: "recorded",
      sourceType: "synthetic",
      status: "completed",
      outcome: index === 0 ? "clear" : "needs_review",
      createdAt: `2026-08-27T00:00:0${index}.000Z`,
      expiresAt: "2026-08-28T00:00:00.000Z",
      deletedAt: null,
      retryCount: 0,
      latencyMs: 100 + index,
      estimatedCostUsd: 0,
      filename: `${id}.pdf`,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs?limit=12") {
        return new Response(JSON.stringify({ runs: publicRuns, pagination: { limit: 12, offset: 0, returned: 2 } }), { status: 200 });
      }
      const id = url.endsWith("public_a") ? "public_a" : "public_b";
      const ownField = id === "public_a" ? field("vendor", "Public Alpha", "Alpha") : field("total", "Public Beta", "Beta");
      return new Response(JSON.stringify({ run: {
        ...publicRuns.find((run) => run.id === id),
        requestedFields: [{ key: ownField.key, label: ownField.label }],
        details: { result: { fields: [ownField], outcome: id === "public_a" ? "clear" : "needs_review", latencyMs: id === "public_a" ? 100 : 101 } },
      } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WorkbenchView />);

    expect(screen.getByText("Loading active public runs…")).toBeVisible();
    expect(await screen.findAllByRole("option", { name: "public_a" })).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: "public_b" })).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("Run A"), "public_a");
    await user.selectOptions(screen.getByLabelText("Run B"), "public_b");
    const comparison = screen.getByRole("table", { name: /comparison of two assurance runs/i });
    expect(comparison).toHaveTextContent("Public Alpha");
    expect(comparison).toHaveTextContent("Public Beta");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows a safe history error without displacing the Workbench", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("untrusted detail", { status: 503 })));
    render(<WorkbenchView />);

    expect(await screen.findByRole("alert", { name: "Public run history unavailable" })).toHaveTextContent(
      "Active public run history is temporarily unavailable.",
    );
    expect(screen.getByRole("heading", { name: "Review a document" })).toBeVisible();
    expect(screen.queryByText("untrusted detail")).not.toBeInTheDocument();
  });
});
