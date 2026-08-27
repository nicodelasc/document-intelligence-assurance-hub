import { runEventSchema } from "@/domain/run-schema";
import type { RunEvent } from "@/domain/types";

export async function consumeNdjson(
  response: Response,
  options: { onEvent: (event: RunEvent) => void },
): Promise<Extract<RunEvent, { type: "completed" | "failed" }>> {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "The run could not start.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: Extract<RunEvent, { type: "completed" | "failed" }> | null = null;
  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = runEventSchema.parse(JSON.parse(line)) as RunEvent;
      options.onEvent(event);
      if (event.type === "completed" || event.type === "failed") terminal = event;
    }
    if (chunk.done) break;
  }
  if (buffer.trim()) {
    const event = runEventSchema.parse(JSON.parse(buffer)) as RunEvent;
    options.onEvent(event);
    if (event.type === "completed" || event.type === "failed") terminal = event;
  }
  if (!terminal) throw new Error("The run stream ended before a final outcome.");
  return terminal;
}
