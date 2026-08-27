// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResourceCalculator } from "@/components/operations/resource-calculator";
import { RunExplorer } from "@/components/operations/run-explorer";

describe("Resource calculator", () => {
  it("uses the pure formula after edits and keeps the illustrative label", async () => {
    const user = userEvent.setup();
    render(<ResourceCalculator averageModelCostPerRun={0.1} />);
    const documents = screen.getByRole("spinbutton", { name: /documents each month/i });
    await user.clear(documents);
    await user.type(documents, "100");

    expect(screen.getAllByText(/Illustrative scenario — not measured savings/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/7\.5 h/)).toBeInTheDocument();
  });
});

describe("Run explorer", () => {
  const runs = Array.from({ length: 12 }, (_, index) => ({
    id: `run_${index + 1}`,
    provider: index % 2 === 0 ? ("openai" as const) : ("anthropic" as const),
    model: index % 2 === 0 ? "gpt-5-mini" : "claude-haiku-4.5",
    executionMode: "recorded" as const,
    sourceType: "synthetic" as const,
    status: index === 11 ? ("expired" as const) : ("completed" as const),
    outcome: "clear" as const,
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 100,
    estimatedCostUsd: 0.01,
    filename: `fixture-${index + 1}.pdf`,
  }));

  it("updates URL state for selection, filters and pagination", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/operations");
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(window.location.search).toContain("page=2");
    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await user.selectOptions(screen.getByLabelText(/provider filter/i), "anthropic");
    expect(window.location.search).toContain("provider=anthropic");
    await user.click(screen.getByRole("radio", { name: /select run_2/i }));
    expect(window.location.search).toContain("run=run_2");
  });

  it("does not display evidence or preview for an expired run", async () => {
    const user = userEvent.setup();
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await user.click(screen.getByRole("radio", { name: /select run_12/i }));
    expect(screen.getByText(/retention metadata only/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /document preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /evidence snippets/i })).not.toBeInTheDocument();
  });
});
