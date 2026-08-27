import { describe, expect, it } from "vitest";
import { scanText } from "../../../scripts/verify-public-surface.mjs";

describe("public-surface verifier", () => {
  it("reports credential values without treating safe environment names as leaks", () => {
    expect(scanText("OPENAI_API_KEY=\nANTHROPIC_API_KEY=", "safe.env")).toEqual([]);

    expect(
      scanText("const leaked = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';", "bundle.js"),
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
});
