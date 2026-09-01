import { afterEach, describe, expect, it, vi } from "vitest";

type LocalWebServer = {
  env?: Record<string, string>;
};

type LoadedConfig = {
  webServer?: LocalWebServer | LocalWebServer[];
};

const connectedKeys = [
  "AI_LIVE_ENABLED",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
] as const;

async function loadPlaywrightConfig(): Promise<LoadedConfig> {
  vi.resetModules();
  return (await import("../../../playwright.config")).default as LoadedConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Playwright local server isolation", () => {
  it("overrides connected settings without storing their sentinel values", async () => {
    const sentinelPrefix = "connected-setting-sentinel";
    const diagnostics: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...values: unknown[]) => {
        diagnostics.push(values.map(String).join(" "));
      });
    }
    const inheritedPath = process.env.PATH;
    vi.stubEnv("PLAYWRIGHT_EXISTING_SERVER", "0");
    vi.stubEnv("ALLOW_IN_MEMORY_PERSISTENCE", "false");
    for (const key of connectedKeys) {
      vi.stubEnv(
        key,
        key === "AI_LIVE_ENABLED" ? "true" : `${sentinelPrefix}-${key}`,
      );
    }

    const config = await loadPlaywrightConfig();
    const webServer = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer;
    const serverEnvironment = webServer?.env ?? {};
    const expectedEnvironment = {
      AI_LIVE_ENABLED: "false",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      DATABASE_URL: "",
      BLOB_READ_WRITE_TOKEN: "",
      CRON_SECRET: "",
      ALLOW_IN_MEMORY_PERSISTENCE: "true",
    };
    const safeChecks = Object.fromEntries(
      Object.entries(expectedEnvironment).map(([key, value]) => [
        key,
        serverEnvironment[key] === value,
      ]),
    );

    expect(webServer).toBeDefined();
    expect(safeChecks).toEqual(
      Object.fromEntries(
        Object.keys(expectedEnvironment).map((key) => [key, true]),
      ),
    );
    expect(
      Object.values(serverEnvironment).some((value) =>
        value.includes(sentinelPrefix),
      ),
    ).toBe(false);
    expect(
      diagnostics.some((diagnostic) => diagnostic.includes(sentinelPrefix)),
    ).toBe(false);
    expect(process.env.PATH === inheritedPath).toBe(true);
  });

  it("does not configure a local web server in existing-server mode", async () => {
    vi.stubEnv("PLAYWRIGHT_EXISTING_SERVER", "1");
    vi.stubEnv("DATABASE_URL", "connected-setting-sentinel-database");

    const config = await loadPlaywrightConfig();

    expect(config.webServer).toBeUndefined();
  });
});
