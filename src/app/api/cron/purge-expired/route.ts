import { getHttpContainer } from "@/server/http/container";
import { handlePurgeExpiredGet } from "@/server/http/cron-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handlePurgeExpiredGet(request, getHttpContainer());
}
