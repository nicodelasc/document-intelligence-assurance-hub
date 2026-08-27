import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const useExistingServer = process.env.PLAYWRIGHT_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: useExistingServer ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/workbench`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
