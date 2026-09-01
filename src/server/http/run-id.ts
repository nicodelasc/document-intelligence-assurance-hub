import { createHash } from "node:crypto";

export function idempotentRunId(idempotencyKey: string): string {
  return `run_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 48)}`;
}
