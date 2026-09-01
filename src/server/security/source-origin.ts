import { createHash } from "node:crypto";
import { sampleOriginManifest } from "./sample-origin-manifest";

const recognizedDigests = new Set(Object.values(sampleOriginManifest));

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyCustomSourceOrigin(
  bytes: Uint8Array,
): "recognized_copy" | "unverified" {
  return recognizedDigests.has(sha256Hex(bytes))
    ? "recognized_copy"
    : "unverified";
}
