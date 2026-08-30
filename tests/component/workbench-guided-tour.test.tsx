// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { WorkbenchView } from "@/components/workbench/workbench-view";

const navigationState = vi.hoisted(() => ({ pathname: "/workbench" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

const targetIds = [
  "workbench-tour-document-library",
  "workbench-tour-processing-model",
  "workbench-tour-process-document",
  "workbench-tour-assurance-trace",
  "workbench-tour-decision",
] as const;

function modelCatalogue() {
  return new Response(JSON.stringify({
    models: [
      {
        id: "gpt-5.6-luna",
        provider: "openai",
        displayName: "GPT-5.6 Luna",
        recommended: true,
      },
    ],
    defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
    providerAvailability: { openai: false, anthropic: false },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function emptyHistory() {
  return new Response(JSON.stringify({
    runs: [],
    pagination: { limit: 12, offset: 0, returned: 0 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function recordedRun() {
  return new Response(`${JSON.stringify({
    type: "completed",
    outcome: "clear",
    runId: "run_tour_blocked_action",
    executionMode: "recorded",
    deletionToken: "tour_token",
    timestamp: "2026-08-30T00:00:00.000Z",
  })}\n`, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function installMatchMedia(reducedMotion = false) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })));
}

function renderWorkbench() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/models") return modelCatalogue();
    if (url === "/api/runs?limit=12") return emptyHistory();
    if (url === "/api/runs" && init?.method === "POST") return recordedRun();
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AppShell>
      <WorkbenchView />
    </AppShell>,
  );
  return fetchMock;
}

function findGuidanceTrigger() {
  return screen.findByRole("button", { name: "How it works" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  navigationState.pathname = "/workbench";
});

describe("Workbench guided tour", () => {
  it("places the emphasized guidance trigger in the Workbench header and mounts every stable target", async () => {
    installMatchMedia();
    renderWorkbench();

    const appHeader = document.querySelector<HTMLElement>(".app-header");
    expect(appHeader).not.toBeNull();
    const trigger = await within(appHeader!).findByRole("button", { name: "How it works" });
    expect(trigger).toHaveClass("guidance-trigger");
    expect(trigger).toHaveTextContent("How it works");
    const productName = within(appHeader!).getByRole("link", {
      name: "Document Intelligence Assurance Hub",
    });
    const navigation = within(appHeader!).getByRole("navigation", { name: "Primary navigation" });
    expect(productName.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review a document" }).closest("header")).not.toContainElement(trigger);
    for (const targetId of targetIds) {
      expect(document.getElementById(targetId)).toBeInTheDocument();
    }
  });

  it("opens a purpose overview and keeps shade or underlying control clicks inert", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    const fetchMock = renderWorkbench();
    const processButton = await screen.findByRole("button", { name: "Process document" });
    await waitFor(() => expect(processButton).toBeEnabled());

    await user.click(await findGuidanceTrigger());
    const overview = screen.getByRole("dialog", { name: "What this workbench does" });
    expect(overview).toHaveTextContent(/agentic document-assurance workflow/i);
    expect(overview).toHaveTextContent(/multimodal document understanding/i);
    expect(overview).toHaveTextContent(/evidence-grounded evaluator checks/i);
    expect(overview).toHaveTextContent(/orchestration, validation and telemetry are implemented/i);
    expect(overview).toHaveTextContent(/synthetic/i);
    expect(overview).toHaveTextContent(/do not update external systems/i);
    expect(within(overview).getByRole("button", { name: "Start guided tour" })).toBeVisible();
    expect(within(overview).getByRole("button", { name: "Close" })).toBeVisible();
    await waitFor(() => expect(
      within(overview).getByRole("button", { name: "Start guided tour" }),
    ).toHaveFocus());

    fireEvent.mouseDown(document.querySelector(".dialog-backdrop")!);
    expect(screen.getByRole("dialog", { name: "What this workbench does" })).toBeVisible();
    fireEvent.click(processButton);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    await user.click(within(overview).getByRole("button", { name: "Start guided tour" }));
    const tour = screen.getByRole("dialog", { name: "Document library" });
    fireEvent.mouseDown(document.querySelector(".dialog-backdrop")!);
    expect(tour).toBeVisible();
    const unselectedDocument = screen.getByRole("button", { name: /Buyer hold/ });
    expect(unselectedDocument).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(unselectedDocument);
    expect(unselectedDocument).toHaveAttribute("aria-pressed", "false");
  });

  it("moves through the exact five steps with Back and Next then finishes at the header trigger", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    renderWorkbench();
    const trigger = await findGuidanceTrigger();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Start guided tour" }));

    const expectedSteps = [
      "Document library",
      "Processing model",
      "Process document",
      "Assurance trace",
      "Decision and next steps",
    ] as const;
    const truthfulStepCopy = [
      /synthetic fixtures.*OCR-style reading.*handwritten comments/i,
      /explicit provider dispatch/i,
      /untrusted document text.*no tool execution/i,
      /observable orchestration.*evaluator checks/i,
      /human-in-the-loop.*staged actions/i,
    ] as const;
    for (let index = 0; index < expectedSteps.length; index += 1) {
      const dialog = screen.getByRole("dialog", { name: expectedSteps[index] });
      expect(within(dialog).getByText(`Step ${index + 1} of 5`)).toBeVisible();
      expect(dialog).toHaveTextContent(truthfulStepCopy[index]);
      await waitFor(() => expect(within(dialog).getByRole("heading", {
        name: expectedSteps[index],
      })).toHaveFocus());
      if (index === 0) {
        await user.keyboard("{Shift>}{Tab}{/Shift}");
        expect(within(dialog).getByRole("button", { name: "Exit guided tour" })).toHaveFocus();
        await user.keyboard("{Tab}");
        expect(within(dialog).getByRole("button", { name: "Next" })).toHaveFocus();
      }
      const back = within(dialog).getByRole("button", { name: "Back" });
      if (index === 0) expect(back).toBeDisabled();
      else expect(back).toBeEnabled();
      if (index === 1) {
        await user.click(within(dialog).getByRole("button", { name: "Back" }));
        expect(screen.getByRole("dialog", { name: "Document library" })).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Next" }));
      }
      if (index < expectedSteps.length - 1) {
        await user.click(screen.getByRole("button", { name: "Next" }));
      }
    }

    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("traps overview focus and restores the header trigger after Escape", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    renderWorkbench();
    const trigger = await findGuidanceTrigger();
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "What this workbench does" });
    const start = within(dialog).getByRole("button", { name: "Start guided tour" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    await waitFor(() => expect(start).toHaveFocus());
    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(start).toHaveFocus();
    start.focus();
    await user.keyboard("{Tab}");
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores the header trigger when the tour is exited", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    renderWorkbench();
    const trigger = await findGuidanceTrigger();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Start guided tour" }));
    await user.click(screen.getByRole("button", { name: "Exit guided tour" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves focus to Close when a ready overview becomes unavailable", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(await findGuidanceTrigger());
    const overview = screen.getByRole("dialog", { name: "What this workbench does" });
    await waitFor(() => expect(
      within(overview).getByRole("button", { name: "Start guided tour" }),
    ).toHaveFocus());

    document.getElementById(targetIds[0])!.remove();

    await waitFor(() => expect(
      within(overview).getByRole("button", { name: "Start guided tour" }),
    ).toBeDisabled());
    expect(within(overview).getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("returns focus to Close when the active tour target disappears", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(await findGuidanceTrigger());
    await user.click(screen.getByRole("button", { name: "Start guided tour" }));
    await waitFor(() => expect(
      screen.getByRole("heading", { name: "Document library" }),
    ).toHaveFocus());

    document.getElementById(targetIds[0])!.remove();

    const overview = await screen.findByRole("dialog", { name: "What this workbench does" });
    expect(within(overview).getByRole("button", { name: "Start guided tour" })).toBeDisabled();
    await waitFor(() => expect(
      within(overview).getByRole("button", { name: "Close" }),
    ).toHaveFocus());
  });

  it("does not reopen guidance after leaving and returning to the Workbench route", async () => {
    installMatchMedia();
    const user = userEvent.setup();
    const { rerender } = render(
      <AppShell><main>Workbench route</main></AppShell>,
    );
    await user.click(await findGuidanceTrigger());
    expect(screen.getByRole("dialog", { name: "What this workbench does" })).toBeVisible();

    navigationState.pathname = "/operations";
    rerender(<AppShell><main>Operations route</main></AppShell>);
    expect(screen.queryByRole("button", { name: "How it works" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    navigationState.pathname = "/workbench";
    rerender(<AppShell><main>Workbench route</main></AppShell>);
    expect(await findGuidanceTrigger()).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses instant target scrolling when reduced motion is requested", async () => {
    installMatchMedia(true);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const user = userEvent.setup();
      renderWorkbench();
      await user.click(await findGuidanceTrigger());
      await user.click(screen.getByRole("button", { name: "Start guided tour" }));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({
        behavior: "auto",
      })));
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (Element.prototype as { scrollIntoView?: typeof scrollIntoView }).scrollIntoView;
      }
    }
  });

  it("recomputes geometry when the current target changes size", async () => {
    installMatchMedia();
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resizeCallback: ResizeObserverCallback | undefined;
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(await findGuidanceTrigger());
    await user.click(screen.getByRole("button", { name: "Start guided tour" }));

    const target = document.getElementById(targetIds[0])!;
    await waitFor(() => expect(observe).toHaveBeenCalledWith(target));
    const rectSpy = vi.spyOn(target, "getBoundingClientRect");
    const callsBeforeResize = rectSpy.mock.calls.length;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    await waitFor(() => expect(rectSpy.mock.calls.length).toBeGreaterThan(callsBeforeResize));

    await user.keyboard("{Escape}");
    expect(disconnect).toHaveBeenCalled();
  });

  it("positions every new tour step before the next animation frame", async () => {
    installMatchMedia();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => {
      frameId += 1;
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(await findGuidanceTrigger());
    await user.click(screen.getByRole("button", { name: "Start guided tour" }));

    const expectPositioned = (name: string) => {
      const callout = screen.getByRole("dialog", { name });
      expect(callout.style.left).toMatch(/px$/);
      expect(callout.style.top).toMatch(/px$/);
    };

    expectPositioned("Document library");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expectPositioned("Processing model");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expectPositioned("Document library");
  });
});
