import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { syntheticFixtures } from "@/domain/fixtures";

describe("synthetic document fixtures", () => {
  it("contains the three required deterministic document scenarios", () => {
    expect(syntheticFixtures.map((fixture) => fixture.id)).toEqual([
      "invoice-exception-packet",
      "warehouse-receiving-sheet",
      "visitor-access-request",
    ]);
    expect(syntheticFixtures.map((fixture) => fixture.expectedOutcome)).toEqual([
      "needs_review",
      "clear",
      "incomplete",
    ]);
  });

  it("keeps every scenario invented and action metadata aligned to its outcome", () => {
    const serializedFixtures = JSON.stringify(syntheticFixtures);
    expect(serializedFixtures).not.toMatch(/Samsung|Kyndryl/i);
    expect(syntheticFixtures.map((fixture) => fixture.action.status)).toEqual([
      "needs_review",
      "ready",
      "blocked",
    ]);
  });

  it("publishes one-page sample PDFs with their exact fixture evidence", async () => {
    for (const fixture of syntheticFixtures) {
      const document = await readFile(
        resolve(process.cwd(), "public", "samples", fixture.filename),
      );
      const pdf = await getDocumentProxy(new Uint8Array(document));
      const extracted = await extractText(pdf, { mergePages: true });

      expect(extracted.totalPages).toBe(1);
      expect(extracted.text).toContain(fixture.title);
      expect(extracted.text).toContain(fixture.action.instructionEvidence);
      for (const { value } of fixture.action.payload) {
        expect(extracted.text).toContain(value);
      }
    }
  });
});
