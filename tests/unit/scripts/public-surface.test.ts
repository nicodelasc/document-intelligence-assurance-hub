import { describe, expect, it } from "vitest";
import {
  scanOrigin,
  scanText,
} from "../../../scripts/verify-public-surface.mjs";

describe("public-surface verifier", () => {
  it("reports credential values without treating safe environment names as leaks", () => {
    expect(scanText("OPENAI_API_KEY=\nANTHROPIC_API_KEY=", "safe.env")).toEqual(
      [],
    );

    expect(
      scanText(
        "const leaked = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';",
        "bundle.js",
      ),
    ).toEqual([
      expect.objectContaining({
        category: "credential-shaped value",
        location: "bundle.js:1",
      }),
    ]);
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
