import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel deployment configuration", () => {
  it("schedules the retention purge every hour without unsupported function overrides", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
      functions?: unknown;
    };

    expect(config.crons).toEqual([
      { path: "/api/cron/purge-expired", schedule: "0 * * * *" },
    ]);
    expect(config.functions).toBeUndefined();
  });
});
