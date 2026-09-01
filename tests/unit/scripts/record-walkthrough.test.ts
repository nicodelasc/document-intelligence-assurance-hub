import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const recorder = readFileSync("scripts/record-walkthrough.mjs", "utf8");

describe("Walkthrough recorder release vocabulary", () => {
  it("records the procurement problem, scoped actions and queue-first Operations story", () => {
    for (const marker of [
      "Review incoming procurement documents",
      "Assess sample without AI processing",
      "Review result",
      "Prepare posting handoff",
      "Draft clarification request",
      "Procurement review operations",
      "Procurement review queue",
      "Review record and technical trace",
    ]) {
      expect(recorder).toContain(marker);
    }

    expect(recorder.indexOf("Procurement review queue")).toBeLessThan(
      recorder.indexOf("Processing performance"),
    );
    expect(recorder).toContain(
      "All documents and reference records are synthetic.",
    );
    expect(recorder).toContain(
      "ERP posting, payment, inventory, email and archive integrations are simulated",
    );
  });

  it("contains no retired primary labels", () => {
    for (const retiredLabel of [
      /\bApprove and stage\b/i,
      /\bRun explorer\b/i,
      /\bProcess document\b/i,
      /\bResolve and prepare action\b/i,
    ]) {
      expect(recorder).not.toMatch(retiredLabel);
    }
  });
});

function runRecorder(baseUrl: string, outputPath: string) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "scripts/record-walkthrough.mjs",
          "--base-url",
          baseUrl,
          "--output",
          outputPath,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            OPENAI_API_KEY: "",
            ANTHROPIC_API_KEY: "",
          },
          windowsHide: true,
        },
      );

      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8");
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stderr, stdout }));
    },
  );
}

describe("Walkthrough recorder provider guard", () => {
  it("preserves the keyless guard error through Windows video cleanup and never opens Workbench", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/api/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            models: [],
            providerAvailability: { openai: true, anthropic: false },
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test_server_address_unavailable");
    }

    const directory = await mkdtemp(
      join(tmpdir(), "walkthrough-provider-guard-test-"),
    );
    try {
      const result = await runRecorder(
        `http://127.0.0.1:${address.port}`,
        join(directory, "walkthrough.webm"),
      );

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "walkthrough_requires_keyless_provider_routes",
      );
      expect(result.stderr).not.toMatch(/EBUSY|resource busy or locked/i);
      expect(requests).toEqual(["/api/models"]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }, 30_000);
});
