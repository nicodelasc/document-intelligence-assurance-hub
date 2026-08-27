// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ComparisonLedger,
  CustomUploadFields,
  ProviderSelector,
} from "@/components/workbench/workbench-controls";
import { consumeNdjson } from "@/components/workbench/run-stream";

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
