// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComparisonLedger,
  CustomUploadFields,
  ModelSelector,
} from "@/components/workbench/workbench-controls";
import { consumeNdjson } from "@/components/workbench/run-stream";
import { WorkbenchView } from "@/components/workbench/workbench-view";
import { ActionCard } from "@/components/workbench/action-card";
import type { ActionProposal, FieldResult, RunEvent } from "@/domain/types";
import { syntheticFixtures } from "@/domain/fixtures";

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

function modelCatalogue(
  providerAvailability: { openai: boolean; anthropic: boolean },
  openaiDefault = "gpt-5.6-luna",
) {
  return new Response(JSON.stringify({
    models: [
      { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
      { id: "gpt-5.6-terra", provider: "openai", displayName: "GPT-5.6 Terra", recommended: false },
      { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
      { id: "claude-sonnet-5", provider: "anthropic", displayName: "Claude Sonnet 5", recommended: false },
    ],
    defaults: { openai: openaiDefault, anthropic: "claude-haiku-4-5" },
    providerAvailability,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const readyAction: ActionProposal = {
  type: "stage_inventory_receipt",
  title: "Stage inventory receipt",
  summary: "Stage the verified receipt for internal inventory posting.",
  payload: [
    { label: "Shipment ID", value: "SHIP-4018" },
    { label: "Received quantity", value: "48" },
  ],
  instructionEvidence: "Corrected received quantity: 48.",
  page: 1,
  risk: "low",
  status: "ready",
  reason: "The corrected quantity matches the expected delivery.",
  stagedAt: null,
};

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
    await waitFor(() => expect(screen.getByLabelText(/document file/i)).toHaveFocus());
  });

  it("groups the approved models and submits the selected model value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const models = [
      { id: "gpt-5.6-luna", provider: "openai" as const, displayName: "GPT-5.6 Luna", recommended: true },
      { id: "gpt-5.6-terra", provider: "openai" as const, displayName: "GPT-5.6 Terra", recommended: false },
      { id: "claude-haiku-4-5", provider: "anthropic" as const, displayName: "Claude Haiku 4.5", recommended: true },
      { id: "claude-sonnet-5", provider: "anthropic" as const, displayName: "Claude Sonnet 5", recommended: false },
    ];
    function ModelHarness() {
      const [value, setValue] = useState("gpt-5.6-luna");
      return (
        <ModelSelector
          models={models}
          value={value}
          onChange={(model) => {
            onChange(model);
            setValue(model);
          }}
        />
      );
    }
    const { container } = render(
      <form>
        <ModelHarness />
      </form>,
    );

    expect(screen.getByRole("group", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Anthropic" })).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Processing model" });
    await user.selectOptions(select, "claude-sonnet-5");
    expect(onChange).toHaveBeenCalledWith("claude-sonnet-5");
    expect(new FormData(container.querySelector("form")!).get("model")).toBe(
      "claude-sonnet-5",
    );
  });

  it("shows two family tabs with five classified variants and opens the native picker", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/models"
        ? modelCatalogue({ openai: false, anthropic: false })
        : emptyHistory(),
    );
    vi.stubGlobal("fetch", fetchMock);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<WorkbenchView />);

    expect(screen.getByRole("tab", { name: "Supplier invoices" })).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "Warehouse goods receipts" }),
    ).toBeVisible();
    const invoicePanel = screen.getByRole("tabpanel");
    expect(within(invoicePanel).getAllByTestId("fixture-variant")).toHaveLength(5);
    expect(within(invoicePanel).getByText("Correct")).toBeVisible();
    expect(within(invoicePanel).getAllByText("Needs attention")).toHaveLength(2);
    expect(within(invoicePanel).getAllByText("Incorrect")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Process document" })).toBeVisible();
    expect(screen.getByLabelText("Processing model")).toHaveValue("gpt-5.6-luna");
    expect(
      screen.getByRole("option", { name: "GPT-5.6 Luna - Recommended" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Claude Haiku 4.5 - Recommended" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(
      screen.queryByRole("option", { name: "GPT-5.6 Terra - Recommended" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Claude Sonnet 5 - Recommended" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/live custom|live provider|live-call/i),
    ).not.toBeInTheDocument();

    const initialFixture = syntheticFixtures[0];
    expect(screen.getByTitle(`Document preview for ${initialFixture.title}`)).toHaveAttribute(
      "src",
      `/samples/${initialFixture.filename}`,
    );
    expect(screen.getByText(initialFixture.differenceSummary[0])).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Warehouse goods receipts" }));
    expect(
      within(screen.getByRole("tabpanel")).getAllByTestId("fixture-variant"),
    ).toHaveLength(5);
    const warehouseFixture = syntheticFixtures.find(
      (fixture) => fixture.id === "warehouse-quantity-mismatch",
    )!;
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(warehouseFixture.variantLabel, "i"),
      }),
    );
    expect(screen.getByTitle(`Document preview for ${warehouseFixture.title}`)).toHaveAttribute(
      "src",
      `/samples/${warehouseFixture.filename}`,
    );
    expect(screen.getByText(warehouseFixture.differenceSummary[0])).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === "/api/runs" && init?.method === "POST",
      ),
    ).toBe(false);

    const upload = screen.getByRole("button", { name: "+ Add your document" });
    await user.click(upload);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Document file")).toHaveAttribute(
      "accept",
      "application/pdf,image/png,image/jpeg",
    );
  });

  it("uses Arrow Home and End keys to activate and focus family tabs", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => emptyHistory()));
    render(<WorkbenchView />);

    const invoiceTab = screen.getByRole("tab", { name: "Supplier invoices" });
    const receiptTab = screen.getByRole("tab", { name: "Warehouse goods receipts" });
    const invoicePanelId = invoiceTab.getAttribute("aria-controls");
    const receiptPanelId = receiptTab.getAttribute("aria-controls");
    expect(invoicePanelId).not.toBeNull();
    expect(receiptPanelId).not.toBeNull();
    expect(document.getElementById(invoicePanelId!)).toBeVisible();
    expect(document.getElementById(receiptPanelId!)).not.toBeVisible();

    invoiceTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(receiptTab).toHaveFocus();
    expect(receiptTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(invoicePanelId!)).not.toBeVisible();
    expect(document.getElementById(receiptPanelId!)).toBeVisible();
    await user.keyboard("{Home}");
    expect(invoiceTab).toHaveFocus();
    expect(invoiceTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(invoicePanelId!)).toBeVisible();
    expect(document.getElementById(receiptPanelId!)).not.toBeVisible();
    await user.keyboard("{End}");
    expect(receiptTab).toHaveFocus();
    expect(receiptTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(invoicePanelId!)).not.toBeVisible();
    expect(document.getElementById(receiptPanelId!)).toBeVisible();
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

describe("Prepared action", () => {
  it("allows a review-required action to be staged", async () => {
    const user = userEvent.setup();
    const reviewAction: ActionProposal = {
      ...readyAction,
      status: "needs_review",
      reason: "A reviewer must confirm the exception before downstream use.",
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          staging: {
            status: "staged",
            action: { ...reviewAction, stagedAt: "2026-08-28T10:00:00.000Z" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionCard runId="run_action_review" action={reviewAction} capabilityToken="review_capability" />);

    expect(screen.getAllByText("Review required")[0]).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Stage action" }));

    expect(await screen.findByText("Action staged")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stages pessimistically and prevents duplicate requests", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionCard runId="run_action_ready" action={readyAction} capabilityToken="ready_capability" />);

    const button = screen.getByRole("button", { name: "Stage action" });
    await user.click(button);
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.queryByText("Action staged")).not.toBeInTheDocument();

    resolveRequest(
      new Response(
        JSON.stringify({
          staging: {
            status: "staged",
            action: { ...readyAction, stagedAt: "2026-08-28T10:00:00.000Z" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    expect(await screen.findByText("Action staged")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run_action_ready/stage-action",
      expect.objectContaining({
        method: "POST",
        headers: { "x-run-capability": "ready_capability" },
      }),
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("ready_capability");
  });

  it("preserves the prepared action and allows retry after failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Action staging is temporarily unavailable." } }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            staging: {
              status: "already_staged",
              action: { ...readyAction, stagedAt: "2026-08-28T10:00:00.000Z" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionCard runId="run_action_retry" action={readyAction} capabilityToken="retry_capability" />);

    await user.click(screen.getByRole("button", { name: "Stage action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Action staging is temporarily unavailable.",
    );
    expect(screen.getByRole("heading", { name: readyAction.title })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Stage action" }));
    expect(await screen.findByText("Action staged")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Comparison ledger", () => {
  const runs = [
    {
      id: "run_a",
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: "openai" as const,
      configuredModel: "gpt-5.6-luna",
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
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: "anthropic" as const,
      configuredModel: "claude-haiku-4-5",
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
      "Selected configuration",
      "Execution mode",
      "Evaluator status",
      "Latency",
      "Outcome",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const comparison = screen.getByRole("table", {
      name: /comparison of two assurance runs/i,
    });
    expect(comparison).toHaveTextContent("openai · GPT-5.6 Luna");
    expect(comparison).toHaveTextContent("anthropic · Claude Haiku 4.5");
    expect(within(comparison).getAllByText("Not called (demo)")).toHaveLength(2);
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
    await waitFor(() => expect(screen.getByLabelText("Document file")).toHaveFocus());
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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/models"
        ? modelCatalogue({ openai: true, anthropic: false })
        : emptyHistory(),
    ));
    render(<WorkbenchView />);
    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Vendor");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));

    await user.click(screen.getByRole("button", { name: "Process document" }));

    await waitFor(() => expect(screen.getByLabelText("Review field 2")).toHaveFocus());
    expect(screen.getByText("Field labels must be unique.")).toBeVisible();
  });
});

describe("Workbench request lifecycle", () => {
  it("applies delayed availability after the active run unlocks", async () => {
    const user = userEvent.setup();
    let resolveModels!: (response: Response) => void;
    let resolveFirstRun!: (response: Response) => void;
    let postCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/models") {
        return new Promise<Response>((resolve) => {
          resolveModels = resolve;
        });
      }
      if (url === "/api/runs?limit=12") return emptyHistory();
      if (url === "/api/runs/run_delayed_models") {
        return new Response(JSON.stringify({
          run: {
            id: "run_delayed_models",
            providerCalled: false,
            provider: null,
            model: null,
            details: { result: { action: readyAction } },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirstRun = resolve;
          });
        }
        return ndjson([{
          type: "failed",
          code: "test_terminal",
          message: "The test run stopped after admission.",
          timestamp: "2026-08-29T00:00:00.000Z",
        }]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Process document" }));
    await waitFor(() => expect(postCount).toBe(1));
    const firstPost = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect((firstPost?.[1]?.body as FormData).get("executionMode")).toBe("recorded");

    await act(async () => {
      resolveModels(
        modelCatalogue({ openai: true, anthropic: false }, "gpt-5.6-terra"),
      );
      await Promise.resolve();
    });
    expect(screen.getByText("Sample results - no AI processing")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Processing model" })).toHaveValue("gpt-5.6-luna");

    await act(async () => {
      resolveFirstRun(ndjson([{
        type: "completed",
        outcome: "clear",
        runId: "run_delayed_models",
        executionMode: "recorded",
        deletionToken: "delayed_models_token",
        timestamp: "2026-08-29T00:00:01.000Z",
      }]));
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Sample results - no AI processing"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("combobox", { name: "Processing model" })).toHaveValue("gpt-5.6-terra");

    await user.click(screen.getByRole("button", { name: "Process document" }));
    await waitFor(() => expect(postCount).toBe(2));
    const secondPost = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")[1];
    expect((secondPost?.[1]?.body as FormData).get("executionMode")).toBe("live");
    expect((secondPost?.[1]?.body as FormData).get("model")).toBe("gpt-5.6-terra");
    expect(new Headers(secondPost?.[1]?.headers).get("x-run-execution-mode")).toBe("live");

    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));
    await user.click(screen.getByRole("button", { name: "Process document" }));

    await waitFor(() => expect(postCount).toBe(3));
    expect(screen.queryByText("Processing unavailable for this model")).not.toBeInTheDocument();
  });

  it.each([
    [true, "live"],
    [false, "recorded"],
  ] as const)(
    "submits a built-in sample with %s OpenAI availability as %s",
    async (openaiAvailable, expectedMode) => {
      const user = userEvent.setup();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/models") {
          return modelCatalogue({ openai: openaiAvailable, anthropic: false });
        }
        if (url === "/api/runs?limit=12") return emptyHistory();
        if (init?.method === "POST") {
          return ndjson([{
            type: "failed",
            code: "test_terminal",
            message: "The test run stopped after admission.",
            timestamp: "2026-08-29T00:00:00.000Z",
          }]);
        }
        return new Response(null, { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<WorkbenchView />);

      const sample = syntheticFixtures.find((candidate) => candidate.id === "invoice-buyer-hold")!;
      await user.click(screen.getByRole("button", { name: new RegExp(sample.title, "i") }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/models",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));
      await user.click(screen.getByRole("button", { name: "Process document" }));

      await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true));
      const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
      expect((postCall?.[1]?.body as FormData).get("sampleId")).toBe("invoice-buyer-hold");
      expect((postCall?.[1]?.body as FormData).get("executionMode")).toBe(expectedMode);
      expect(new Headers(postCall?.[1]?.headers).get("x-run-source-type")).toBe("synthetic");
      expect(new Headers(postCall?.[1]?.headers).get("x-run-execution-mode")).toBe(expectedMode);
    },
  );

  it("does not submit a custom file when the selected provider is unavailable", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/models") {
        return modelCatalogue({ openai: false, anthropic: false });
      }
      return emptyHistory();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));

    expect(screen.getByText("Processing unavailable for this model")).toBeVisible();
    expect(screen.getByRole("button", { name: "Process document" })).toBeDisabled();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it("uses durable provider attribution after a completed live admission", async () => {
    const existingRun = {
      id: "existing_recorded",
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: "anthropic",
      configuredModel: "claude-haiku-4-5",
      executionMode: "recorded",
      status: "completed",
      outcome: "clear",
      latencyMs: 12,
      details: { result: { fields: [field("total", "12", "12")] } },
    };
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/models") {
        return modelCatalogue({ openai: true, anthropic: false });
      }
      if (url === "/api/runs?limit=12") {
        return new Response(JSON.stringify({
          runs: [{ id: existingRun.id, status: existingRun.status }],
          pagination: { limit: 12, offset: 0, returned: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/runs/existing_recorded") {
        return new Response(JSON.stringify({ run: existingRun }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/runs/run_durable_attribution") {
        return new Response(JSON.stringify({
          run: {
            id: "run_durable_attribution",
            providerCalled: false,
            provider: null,
            model: null,
            details: { result: { action: readyAction } },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") {
        return ndjson([
          { type: "field", field: field("vendor", "Live admission", "Live admission"), timestamp: "2026-08-29T00:00:00.000Z" },
          { type: "completed", outcome: "clear", runId: "run_durable_attribution", executionMode: "live", deletionToken: "durable_token", timestamp: "2026-08-29T00:00:01.000Z" },
        ]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Process document" }));
    expect(await screen.findByRole("heading", { name: readyAction.title })).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Run A"), "existing_recorded");
    await user.selectOptions(screen.getByLabelText("Run B"), "run_durable_attribution");

    const table = screen.getByRole("table", { name: /comparison of two assurance runs/i });
    const providerRow = within(table).getByRole("row", { name: /Provider and model/i });
    expect(within(providerRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Not called (demo)",
      "Not called (demo)",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run_durable_attribution",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("locks run configuration from validation through execution", async () => {
    const user = userEvent.setup();
    let resolveRun!: (response: Response) => void;
    let resolveModels!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/models") {
        return new Promise<Response>((resolve) => {
          resolveModels = resolve;
        });
      }
      if (init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveRun = resolve;
        });
      }
      if (url === "/api/runs/run_locked_configuration") {
        return new Response(
          JSON.stringify({ run: { id: "run_locked_configuration", providerCalled: false, provider: null, model: null, details: { result: { action: readyAction } } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return emptyHistory();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    const selectedFixture = screen.getByRole("button", { name: /Northstar Office Supply invoice/i });
    await user.click(screen.getByRole("button", { name: "Process document" }));

    expect(selectedFixture).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Add your document" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Processing model" })).toBeDisabled();
    expect(screen.getByLabelText("Document file")).toBeDisabled();
    expect(
      screen.getByRole("tab", { name: "Warehouse goods receipts" }),
    ).toBeDisabled();
    expect(selectedFixture).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      resolveModels(
        new Response(
          JSON.stringify({
            models: [
              { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
              { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
            ],
            defaults: { openai: "claude-haiku-4-5" },
            providerAvailability: { openai: false, anthropic: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await Promise.resolve();
    });
    expect(screen.getByRole("combobox", { name: "Processing model" })).toHaveValue("gpt-5.6-luna");

    resolveRun(ndjson([
      { type: "completed", outcome: "clear", runId: "run_locked_configuration", executionMode: "recorded", deletionToken: "locked_token", timestamp: "2026-08-28T00:00:00.100Z" },
    ]));
    expect(await screen.findByRole("heading", { name: readyAction.title })).toBeVisible();
  });

  it("shows honest action-detail loading then a recoverable failure", async () => {
    const user = userEvent.setup();
    let detailCalls = 0;
    let resolveFirstDetail!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return ndjson([
          { type: "completed", outcome: "clear", runId: "run_detail_recovery", executionMode: "recorded", deletionToken: "detail_capability", timestamp: "2026-08-28T00:00:00.100Z" },
        ]);
      }
      if (url === "/api/runs/run_detail_recovery") {
        detailCalls += 1;
        if (detailCalls === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirstDetail = resolve;
          });
        }
        return new Response(
          JSON.stringify({ run: { id: "run_detail_recovery", providerCalled: false, provider: null, model: null, details: { result: { action: readyAction } } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return emptyHistory();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Process document" }));

    expect(await screen.findByText("Loading prepared action")).toBeVisible();
    expect(screen.queryByText("No action available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument();

    resolveFirstDetail(
      new Response(JSON.stringify({ error: { message: "private upstream detail" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(await screen.findByRole("alert", { name: "Prepared action unavailable" })).toHaveTextContent(
      "The prepared action is temporarily unavailable.",
    );
    await user.click(screen.getByRole("button", { name: "Retry prepared action" }));
    expect(await screen.findByRole("heading", { name: readyAction.title })).toBeVisible();
    expect(detailCalls).toBe(2);
  });

  it("marks the active grouped stage failed after a terminal failure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return emptyHistory();
        return ndjson([
          { type: "stage", stage: "comparing", timestamp: "2026-08-28T00:00:00.000Z" },
          {
            type: "failed",
            code: "provider_unavailable",
            message: "The run stopped safely.",
            runId: "run_group_failure",
            deletionToken: "group_failure_token",
            timestamp: "2026-08-28T00:00:00.100Z",
          },
        ]);
      }),
    );
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Process document" }));

    const failedGroup = screen
      .getByText("Resolve and prepare action")
      .closest("li");
    expect(failedGroup).not.toBeNull();
    expect(within(failedGroup!).getByText("Needs attention")).toBeVisible();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("projects a failure during publishing onto the final visible group", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return emptyHistory();
        return ndjson([
          { type: "stage", stage: "validating", timestamp: "2026-08-28T00:00:00.000Z" },
          { type: "stage", stage: "storing", timestamp: "2026-08-28T00:00:00.100Z" },
          { type: "stage", stage: "extracting", timestamp: "2026-08-28T00:00:00.200Z" },
          { type: "stage", stage: "verifying", timestamp: "2026-08-28T00:00:00.300Z" },
          { type: "stage", stage: "comparing", timestamp: "2026-08-28T00:00:00.400Z" },
          { type: "stage", stage: "deciding", timestamp: "2026-08-28T00:00:00.500Z" },
          { type: "stage", stage: "publishing", timestamp: "2026-08-28T00:00:00.600Z" },
          {
            type: "failed",
            code: "storage_unavailable",
            message: "The run stopped safely.",
            runId: "run_publishing_failure",
            deletionToken: "publishing_failure_token",
            timestamp: "2026-08-28T00:00:00.700Z",
          },
        ]);
      }),
    );
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "Process document" }));

    const failedGroup = screen.getByText("Resolve and prepare action").closest("li");
    expect(failedGroup).not.toBeNull();
    expect(within(failedGroup!).getByText("Needs attention")).toBeVisible();
    expect(screen.queryByText(/publishing/i)).not.toBeInTheDocument();
  });

  it("shows three visible stages and places the prepared action before evidence", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/models") {
        return new Response(
          JSON.stringify({
            models: [
              { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
              { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
            ],
            defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
            providerAvailability: { openai: false, anthropic: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "/api/runs?limit=12") return emptyHistory();
      if (url === "/api/runs/run_action_result") {
        return new Response(
          JSON.stringify({
            run: {
              id: "run_action_result",
              providerCalled: false,
              provider: null,
              model: null,
              details: { result: { action: readyAction } },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (init?.method === "POST") {
        return ndjson([
          { type: "stage", stage: "validating", timestamp: "2026-08-28T00:00:00.000Z" },
          { type: "stage", stage: "storing", timestamp: "2026-08-28T00:00:00.100Z" },
          { type: "stage", stage: "extracting", timestamp: "2026-08-28T00:00:00.200Z" },
          { type: "stage", stage: "verifying", timestamp: "2026-08-28T00:00:00.300Z" },
          { type: "stage", stage: "comparing", timestamp: "2026-08-28T00:00:00.400Z" },
          { type: "stage", stage: "deciding", timestamp: "2026-08-28T00:00:00.500Z" },
          { type: "stage", stage: "publishing", timestamp: "2026-08-28T00:00:00.600Z" },
          { type: "completed", outcome: "clear", runId: "run_action_result", executionMode: "recorded", deletionToken: "delete_action_result", timestamp: "2026-08-28T00:00:00.700Z" },
        ]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    await user.click(screen.getByRole("tab", { name: "Warehouse goods receipts" }));
    await user.click(screen.getByRole("button", { name: /Harborline Components goods receipt/i }));
    await user.click(screen.getByRole("button", { name: "Process document" }));

    expect(await screen.findByRole("heading", { name: "Stage inventory receipt" })).toBeVisible();
    for (const label of [
      "Understand document",
      "Verify evidence",
      "Resolve and prepare action",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.queryByText(/publish telemetry/i)).not.toBeInTheDocument();
    const actionHeading = screen.getByRole("heading", { name: "Prepared action" });
    const evidenceHeading = screen.getByRole("heading", { name: "Evidence ledger" });
    expect(
      actionHeading.compareDocumentPosition(evidenceHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run_action_result",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sends custom preflight metadata with a failed terminal event", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/models") {
        return modelCatalogue({ openai: true, anthropic: false });
      }
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
    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));
    await user.click(screen.getByRole("button", { name: "Process document" }));

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

    await user.click(screen.getByRole("button", { name: "Process document" }));

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

  it("labels a custom partial result as incomplete evidence without a consistent claim", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/models") {
        return modelCatalogue({ openai: true, anthropic: false });
      }
      if (url === "/api/runs?limit=12") return emptyHistory();
      if (url === "/api/runs/run_custom_partial") {
        return new Response(JSON.stringify({
          run: {
            id: "run_custom_partial",
            providerCalled: true,
            provider: "openai",
            model: "gpt-5.6-luna",
            details: { result: { action: readyAction } },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") {
        return ndjson([
          {
            type: "field",
            field: field("vendor", "Northstar", "Northstar"),
            timestamp: "2026-08-29T00:00:00.000Z",
          },
          {
            type: "field",
            field: {
              ...field("total", "", ""),
              extractedValue: null,
              normalizedValue: null,
              evidence: null,
              page: null,
              evaluatorStatus: "not_found",
            },
            timestamp: "2026-08-29T00:00:00.100Z",
          },
          {
            type: "completed",
            outcome: "not_found",
            runId: "run_custom_partial",
            executionMode: "live",
            deletionToken: "partial_delete_token",
            timestamp: "2026-08-29T00:00:00.200Z",
          },
        ]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);

    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "partial.png",
        { type: "image/png" },
      ),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));
    await user.click(screen.getByRole("button", { name: "Process document" }));

    expect(
      await screen.findByRole("heading", {
        name: "Incomplete evidence - one or more requested fields were not found",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Evidence-consistent")).not.toBeInTheDocument();
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
      if (String(_input) === "/api/models") {
        return modelCatalogue({ openai: true, anthropic: false });
      }
      if (!init?.method) {
        const runId = String(_input).split("/").at(-1);
        if (runId === "run_custom_a" || runId === "run_custom_b") {
          return new Response(JSON.stringify({
            run: {
              id: runId,
              providerCalled: true,
              provider: "openai",
              model: "gpt-5.6-luna",
              details: { result: { action: readyAction } },
            },
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return emptyHistory();
      }
      return terminals.shift()!;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkbenchView />);
    await user.click(screen.getByRole("button", { name: "+ Add your document" }));
    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "safe.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Review field 1"), "Vendor");
    await user.type(screen.getByLabelText("Review field 2"), "Total");
    await user.click(screen.getByRole("checkbox", { name: /publicly visible/i }));

    await user.click(screen.getByRole("button", { name: "Process document" }));
    expect(await screen.findByRole("heading", { name: "Evidence-consistent" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Process document" }));
    expect(
      await screen.findByRole("heading", {
        name: "Incomplete evidence - one or more requested fields were not found",
      }),
    ).toHaveFocus();

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
    await user.click(screen.getByRole("button", { name: "Process document" }));
    await waitFor(() => expect(activeSignal).toBeDefined());

    view.unmount();

    expect(activeSignal?.aborted).toBe(true);
  });
});

describe("Public run history", () => {
  it("hydrates bounded active details after refresh for complete comparison", async () => {
    const publicRuns = ["public_a", "public_b"].map((id, index) => ({
      id,
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: index === 0 ? "openai" : "anthropic",
      configuredModel:
        index === 0 ? "gpt-5.6-luna" : "claude-haiku-4-5",
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("accepts a configured live run with no confirmed provider call", async () => {
    const listRun = {
      id: "live_pre_dispatch_failure",
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: "anthropic",
      configuredModel: "claude-sonnet-5",
      executionMode: "live",
      sourceType: "custom",
      status: "failed",
      outcome: "incomplete",
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      deletedAt: null,
      retryCount: 0,
      latencyMs: 10,
      estimatedCostUsd: 0,
      filename: "invoice.pdf",
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs?limit=12") {
        return new Response(JSON.stringify({ runs: [listRun], pagination: { limit: 12, offset: 0, returned: 1 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ run: {
        ...listRun,
        requestedFields: [{ key: "vendor", label: "Vendor" }],
        details: { result: { fields: [field("vendor", "Public vendor", "Public vendor")], outcome: "incomplete", latencyMs: 10 } },
      } }), { status: 200 });
    }));
    render(<WorkbenchView />);

    expect(await screen.findAllByRole("option", { name: "live_pre_dispatch_failure" })).toHaveLength(2);
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
