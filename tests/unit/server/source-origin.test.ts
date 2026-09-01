import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyCustomSourceOrigin,
  sha256Hex,
} from "@/server/security/source-origin";

async function readFixture(filename: string) {
  return new Uint8Array(await readFile(resolve("public/samples", filename)));
}

describe("source origin", () => {
  it("recognizes exact committed fixture bytes regardless of upload filename", async () => {
    const bytes = await readFixture("invoice-clean-match.pdf");

    expect(classifyCustomSourceOrigin(bytes)).toBe("recognized_copy");
  });

  it("accepts one changed byte as unverified instead of rejecting it", async () => {
    const bytes = await readFixture("invoice-clean-match.pdf");
    const changed = new Uint8Array(bytes);
    changed[changed.length - 1] ^= 1;

    expect(classifyCustomSourceOrigin(changed)).toBe("unverified");
  });

  it("does not treat a PNG screenshot as an exact PDF copy", async () => {
    const bytes = await readFixture("invoice-clean-match.png");

    expect(classifyCustomSourceOrigin(bytes)).toBe("unverified");
  });

  it("returns a lowercase 64-character digest", () => {
    expect(sha256Hex(new TextEncoder().encode("document"))).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
