import { getHttpContainer } from "@/server/http/container";
import { handleMetricsGet } from "@/server/http/metrics-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleMetricsGet(request, getHttpContainer());
}
