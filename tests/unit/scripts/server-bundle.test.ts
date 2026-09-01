import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findInvalidOcrBundlePatterns,
  verifyServerBundle,
} from "../../../scripts/verify-server-bundle.mjs";

describe("server bundle verifier", () => {
  it("detects a numeric module ID passed to dirname near the OCR language path", () => {
    const source = 'let p=(0,r.join)((0,r.dirname)(55726),"4.0.0_best_int")';

    expect(findInvalidOcrBundlePatterns(source)).toHaveLength(1);
  });

  it("accepts an exported package language path", () => {
    const source = 'let p=t.langPath.replace(/4\\.0\\.0$/,"4.0.0_best_int")';

    expect(findInvalidOcrBundlePatterns(source)).toEqual([]);
  });

  it("rejects a build whose runs function omits the selected OCR language data", () => {
    const root = mkdtempSync(join(tmpdir(), "server-bundle-verifier-"));
    const server = join(root, "server");
    const chunks = join(server, "chunks");
    const route = join(server, "app", "api", "runs");
    mkdirSync(chunks, { recursive: true });
    mkdirSync(route, { recursive: true });
    writeFileSync(
      join(chunks, "grounding.js"),
      'let p=t.langPath.replace(/4\\.0\\.0$/,"4.0.0_best_int")',
    );
    writeFileSync(
      join(route, "route.js.nft.json"),
      JSON.stringify({ version: 1, files: ["eng/4.0.0/eng.traineddata.gz"] }),
    );

    try {
      expect(() => verifyServerBundle(server)).toThrow(
        /selected OCR language data is missing/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a build whose OCR worker omits its image type dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "server-bundle-verifier-"));
    const server = join(root, "server");
    const chunks = join(server, "chunks");
    const route = join(server, "app", "api", "runs");
    mkdirSync(chunks, { recursive: true });
    mkdirSync(route, { recursive: true });
    writeFileSync(
      join(chunks, "grounding.js"),
      'let p=t.langPath.replace(/4\\.0\\.0$/,"4.0.0_best_int")',
    );
    writeFileSync(
      join(route, "route.js.nft.json"),
      JSON.stringify({
        version: 1,
        files: [
          "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
          "tesseract.js/src/worker-script/utils/dump.js",
        ],
      }),
    );

    try {
      expect(() => verifyServerBundle(server)).toThrow(
        /OCR worker image type dependency is missing/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a build whose OCR worker omits an external runtime dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "server-bundle-verifier-"));
    const server = join(root, "server");
    const chunks = join(server, "chunks");
    const route = join(server, "app", "api", "runs");
    mkdirSync(chunks, { recursive: true });
    mkdirSync(route, { recursive: true });
    writeFileSync(
      join(chunks, "grounding.js"),
      'let p=t.langPath.replace(/4\\.0\\.0$/,"4.0.0_best_int")',
    );
    writeFileSync(
      join(route, "route.js.nft.json"),
      JSON.stringify({
        version: 1,
        files: [
          "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
          "tesseract.js/src/constants/imageType.js",
          "is-url/index.js",
          "node-fetch/lib/index.js",
          "regenerator-runtime/runtime.js",
          "tesseract.js-core/tesseract-core.js",
          "wasm-feature-detect/dist/cjs/index.cjs",
        ],
      }),
    );

    try {
      expect(() => verifyServerBundle(server)).toThrow(
        /OCR worker runtime dependency bmp-js is missing/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
