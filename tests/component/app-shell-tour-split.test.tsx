// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

const navigationState = vi.hoisted(() => ({ pathname: "/operations" }));
const tourModuleState = vi.hoisted(() => ({ operationsLoads: 0, workbenchLoads: 0 }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/components/workbench/how-it-works-dialog", () => {
  tourModuleState.workbenchLoads += 1;
  return { HowItWorksDialog: () => null };
});

vi.mock("@/components/operations/operations-guidance-control", () => {
  tourModuleState.operationsLoads += 1;
  return {
    OperationsGuidanceControl: () => <button type="button">How it works</button>,
  };
});

afterEach(() => {
  navigationState.pathname = "/operations";
});

it("loads only the route-specific guidance control on cold Operations then Workbench", async () => {
  const { rerender } = render(<AppShell><main>Operations route</main></AppShell>);
  expect(await screen.findByRole("button", { name: "How it works" })).toBeVisible();
  expect(tourModuleState.workbenchLoads).toBe(0);
  expect(tourModuleState.operationsLoads).toBe(1);

  navigationState.pathname = "/workbench";
  rerender(<AppShell><main>Workbench route</main></AppShell>);
  expect(await screen.findByRole("button", { name: "How it works" })).toBeVisible();
  await waitFor(() => expect(tourModuleState.workbenchLoads).toBe(1));
  expect(tourModuleState.operationsLoads).toBe(1);
});
