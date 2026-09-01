import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import { sampleOriginManifest } from "@/server/security/sample-origin-manifest";

const projectRoot = process.cwd();
const generator = join(
  projectRoot,
  "scripts",
  "generate-sample-origin-manifest.mjs",
);

describe("sample origin manifest generator", () => {
  it("keeps the checked-in manifest current with one digest for every canonical PDF", () => {
    const result = spawnSync(process.execPath, [generator, "--check"], {
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(Object.keys(sampleOriginManifest)).toEqual(
      syntheticFixtures
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((fixture) => fixture.filename),
    );
    expect(Object.values(sampleOriginManifest)).toEqual(
      expect.arrayContaining(
        syntheticFixtures.map(() => expect.stringMatching(/^[a-f0-9]{64}$/)),
      ),
    );
  });

  it("reports drift without changing the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sample-origin-manifest-"));
    const outputPath = join(directory, "sample-origin-manifest.ts");

    try {
      const result = spawnSync(process.execPath, [generator, "--check"], {
        encoding: "utf8",
        env: { ...process.env, SAMPLE_ORIGIN_MANIFEST_PATH: outputPath },
      });

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("sample_origin_manifest_drift");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
