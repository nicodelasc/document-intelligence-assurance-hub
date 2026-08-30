// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

const navigationState = vi.hoisted(() => ({ pathname: "/operations" }));
const tourModuleState = vi.hoisted(() => ({ loads: 0 }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/components/workbench/how-it-works-dialog", () => {
  tourModuleState.loads += 1;
  return { HowItWorksDialog: () => null };
});

afterEach(() => {
  navigationState.pathname = "/operations";
});

it("does not load the Workbench tour module on Operations and loads it only for Workbench", async () => {
  const { rerender } = render(<AppShell><main>Operations route</main></AppShell>);
  expect(tourModuleState.loads).toBe(0);

  navigationState.pathname = "/workbench";
  rerender(<AppShell><main>Workbench route</main></AppShell>);
  expect(await screen.findByRole("button", { name: "How it works" })).toBeVisible();
  await waitFor(() => expect(tourModuleState.loads).toBe(1));
});
