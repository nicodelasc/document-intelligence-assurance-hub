import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("deployment security headers", () => {
  it("sets a Next-compatible same-origin CSP and browser isolation policy", async () => {
    if (typeof nextConfig.headers !== "function") {
      throw new Error("security headers are not configured");
    }
    const rules = await nextConfig.headers();
    const catchAll = rules.find((rule) => rule.source === "/(.*)");
    const headers = new Map(
      catchAll?.headers.map((header) => [
        header.key.toLowerCase(),
        header.value,
      ]),
    );
    const csp = headers.get("content-security-policy") ?? "";

    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/);
  });

  it("allows the exact document route to render only inside the same origin", async () => {
    if (typeof nextConfig.headers !== "function") {
      throw new Error("security headers are not configured");
    }
    const rules = await nextConfig.headers();
    const catchAllIndex = rules.findIndex((rule) => rule.source === "/(.*)");
    const documentIndex = rules.findIndex(
      (rule) => rule.source === "/api/runs/:id/document",
    );
    const documentHeaders = new Map(
      rules[documentIndex]?.headers.map((header) => [
        header.key.toLowerCase(),
        header.value,
      ]),
    );
    const csp = documentHeaders.get("content-security-policy") ?? "";

    expect(catchAllIndex).toBeGreaterThanOrEqual(0);
    expect(documentIndex).toBeGreaterThan(catchAllIndex);
    expect(documentHeaders.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });
});
