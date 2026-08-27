import { getHttpContainer } from "@/server/http/container";
import { handleRunsGet, handleRunsPost } from "@/server/http/runs-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRunsPost(request, getHttpContainer());
}

export async function GET(request: Request): Promise<Response> {
  return handleRunsGet(request, getHttpContainer());
}
