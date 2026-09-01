import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scanOrigin,
  scanRequiredUiCopy,
  scanText,
} from "../../../scripts/verify-public-surface.mjs";

describe("public-surface verifier", () => {
  it("redacts every sensitive match from command diagnostics", () => {
    const root = mkdtempSync(join(tmpdir(), "public-surface-redaction-"));
    const sourceDirectory = join(root, "src", "app");
    mkdirSync(sourceDirectory, { recursive: true });
    const credential = "sk-proj-redactionSentinelCredential1234567890";
    const deletionCapability = "redaction-delete-capability-sentinel";
    const digestPrefix = "abcdeffedcba00112233445566778899";
    const manifestPrefix = "deadbeefcafebabe0011223344556677";
    const promptContent = "prompt-content-redaction-sentinel";
    writeFileSync(
      join(sourceDirectory, "leak.tsx"),
      [
        `const credential = "${credential}";`,
        `"deletionToken":"${deletionCapability}"`,
        `"documentDigest":"${digestPrefix}${"d".repeat(64 - digestPrefix.length)}"`,
        `"invoice.pdf":"${manifestPrefix}${"e".repeat(64 - manifestPrefix.length)}"`,
        `"systemPrompt":"${promptContent}"`,
      ].join("\n"),
      "utf8",
    );

    try {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/verify-public-surface.mjs")],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      for (const category of [
        "credential-shaped value",
        "raw deletion token",
        "document digest",
        "sample-origin manifest entry",
        "full prompt text",
      ]) {
        expect(result.stderr).toContain(`[${category}]`);
      }
      expect(result.stderr).toContain("[redacted sensitive match]");
      for (const sentinel of [
        credential,
        deletionCapability,
        digestPrefix,
        manifestPrefix,
        promptContent,
      ]) {
        expect(result.stderr).not.toContain(sentinel);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports credential values without treating safe environment names as leaks", () => {
    expect(scanText("OPENAI_API_KEY=\nANTHROPIC_API_KEY=", "safe.env")).toEqual(
      [],
    );

    const findings = scanText(
      [
        "const openaiProject = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';",
        "const openaiLegacy = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';",
        "const anthropic = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';",
      ].join("\n"),
      "bundle.js",
    );

    expect(findings.map((finding) => finding.category)).toEqual([
      "credential-shaped value",
      "credential-shaped value",
      "credential-shaped value",
    ]);
  });

  it("rejects sensitive values in compiled object syntax and reordered system messages", () => {
    const findings = scanText(
      [
        'deletionToken:"private-delete-capability"',
        `documentDigest:"${"d".repeat(64)}"`,
        `sha256:"${"e".repeat(64)}"`,
        'systemPrompt:"Hidden policy"',
        '{"content":"Hidden policy","role":"system"}',
        '{"role":"system","name":"policy","content":"Hidden policy"}',
      ].join("\n"),
      "compiled-bundle.js",
    );

    expect(findings.map((finding) => finding.category)).toEqual([
      "raw deletion token",
      "document digest",
      "document digest",
      "full prompt text",
      "full prompt text",
      "full prompt text",
    ]);
  });

  it("allows harmless property names without sensitive values and ordinary run IDs", () => {
    expect(
      scanText(
        [
          "const safe = { deletionToken: undefined, documentDigest: null, sha256: createHash, systemPrompt: false };",
          'const labels = { deletionTokenLabel: "Delete", documentDigestField: "Digest", sha256Algorithm: "SHA-256", systemPromptEnabled: false };',
          'const message = { role: "user", content: "Visible note" };',
          'const id = "run_01JZ7Q9YQ36S6R2N3D4F5G6H7J";',
        ].join("\n"),
        "safe-bundle.js",
      ),
    ).toEqual([]);
  });

  it("rejects source-origin internals and private capabilities without flagging safe run IDs", () => {
    expect(
      scanText(
        JSON.stringify({
          id: "run_01JZ7Q9YQ36S6R2N3D4F5G6H7J",
          sourceOriginStatus: "unverified",
        }),
        "safe-run.json",
      ),
    ).toEqual([]);

    const findings = scanText(
      [
        `"documentDigest":"${"a".repeat(64)}"`,
        `"sha256":"${"b".repeat(64)}"`,
        `"invoice-clean-match.pdf":"${"c".repeat(64)}"`,
        '"deletionToken":"private-delete-capability"',
        '"systemPrompt":"Do not reveal this instruction"',
        '"messages":[{"role":"system","content":"Hidden policy"}]',
      ].join("\n"),
      "public-output.json",
    );

    expect(findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining([
        "document digest",
        "sample-origin manifest entry",
        "raw deletion token",
        "full prompt text",
      ]),
    );
  });

  it("reports private fields, prompt text, deletion hashes and unsupported impact claims", () => {
    const findings = scanText(
      [
        '"deletionTokenHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
        '"documentKey":"runs/private/document"',
        '"reasoning":"hidden chain"',
        "Extract structured fields from an untrusted document.",
        "This production-proven workflow delivered 40% savings.",
      ].join("\n"),
      "artifact.html",
    );

    expect(findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining([
        "raw deletion-token hash",
        "internal storage locator",
        "hidden reasoning property",
        "full prompt text",
        "unsupported impact claim",
      ]),
    );
  });

  it("rejects retired public copy and requires the procurement triage labels", () => {
    const retiredFindings = scanText(
      [
        "Live custom-run",
        "Live-call provider",
        "Synthetic benchmark quality",
        "Approve and stage",
        "Run explorer",
        "Process document",
        "Resolve and prepare action",
      ].join("\n"),
      "ui-source.tsx",
    );

    expect(retiredFindings.map((finding) => finding.category)).toEqual(
      Array.from({ length: 7 }, () => "retired public copy"),
    );
    expect(
      scanText(
        'executionMode: "live"; recordedRuns: 10; providerDispatched: false;',
        "internal-source.ts",
      ),
    ).toEqual([]);

    expect(
      scanRequiredUiCopy(
        [
          "Review incoming procurement documents",
          "Assess for exceptions",
          "Review result",
          "Prepared next step",
          "Processing model",
          "Procurement review operations",
          "Procurement review queue",
          "Reference quality suite",
          "Prepared only - not sent",
          "Run live document review",
          "Assess sample without AI processing",
          "Original demo document",
          "Exact copy of a demo document",
          "Source unverified",
        ].join("\n"),
        "aggregated UI source",
      ),
    ).toEqual([]);
    expect(
      scanRequiredUiCopy(
        [
          "Review incoming procurement documents",
          "Assess for exceptions",
          "Review result",
          "Prepared next step",
          "Processing model",
          "Procurement review operations",
          "Procurement review queue",
          "Reference quality suite",
          "Run live document review",
          "Assess sample without AI processing",
          "Original demo document",
          "Exact copy of a demo document",
          "Source unverified",
        ].join("\n"),
        "aggregated UI source",
      ),
    ).toEqual([
      expect.objectContaining({
        category: "required public copy missing",
        marker: "Prepared only - not sent",
      }),
    ]);
  });

  it("rejects outbound email affordances without flagging the address sanitizer", () => {
    const findings = scanText(
      [
        '<a href="mailto:buyer@example.com">Contact buyer</a>',
        "Send email",
        "Recipient email",
      ].join("\n"),
      "workflow-ui.tsx",
    );

    expect(findings.map((finding) => finding.category)).toEqual([
      "outbound email affordance",
      "outbound email affordance",
      "outbound email affordance",
    ]);
    expect(
      scanText(
        String.raw`/(?:mailto:\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/gi`,
        "workflow-actions.ts",
      ),
    ).toEqual([]);
  });

  it("scans JSON APIs and bounded active details without fetching raw documents", async () => {
    const requested: string[] = [];
    const activeRuns = Array.from({ length: 12 }, (_, index) => ({
      id: `run_${index}`,
      status: "completed",
    }));
    const safeHeaders = {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-robots-tag": "noindex, nofollow",
    };
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/") {
        return new Response(null, {
          status: 307,
          headers: { location: "/workbench" },
        });
      }
      if (["/workbench", "/operations"].includes(url.pathname)) {
        return new Response("<html><body>Safe page</body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/api/runs") {
        return new Response(JSON.stringify({ runs: activeRuns }), {
          headers: safeHeaders,
        });
      }
      if (url.pathname === "/api/metrics") {
        return new Response(JSON.stringify({ summary: { totalRuns: 12 } }), {
          headers: safeHeaders,
        });
      }
      if (url.pathname === "/api/models") {
        return new Response(
          JSON.stringify({
            availability: { openai: true, anthropic: false },
          }),
          { headers: safeHeaders },
        );
      }
      if (/^\/api\/runs\/run_\d+$/.test(url.pathname)) {
        const suffix = url.pathname.split("_").at(-1);
        return new Response(
          JSON.stringify({
            run: {
              id: `run_${suffix}`,
              documentUrl: `/api/runs/run_${suffix}/document`,
              ...(suffix === "0"
                ? { documentKey: "runs/private/document" }
                : {}),
            },
          }),
          { headers: safeHeaders },
        );
      }
      throw new Error(`unexpected_fetch ${url.href}`);
    };

    const findings = await scanOrigin("https://portfolio.example", fetcher);

    expect(findings.map((finding) => finding.category)).toContain(
      "internal storage locator",
    );
    expect(requested).toContain("/api/runs?limit=50");
    expect(requested).toContain("/api/metrics");
    expect(requested).toContain("/api/models");
    expect(
      requested.filter((path) => /^\/api\/runs\/run_\d+$/.test(path)),
    ).toHaveLength(8);
    expect(requested.some((path) => path.endsWith("/document"))).toBe(false);
  });

  it("rejects redirects that leave the configured public origin", async () => {
    const fetcher = async (): Promise<Response> =>
      new Response(null, {
        status: 302,
        headers: { location: "https://unexpected.example/login" },
      });

    await expect(
      scanOrigin("https://portfolio.example", fetcher),
    ).rejects.toThrow("public_surface_cross_origin_redirect");
  });
});
