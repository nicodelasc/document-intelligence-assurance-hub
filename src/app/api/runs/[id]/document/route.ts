import { getHttpContainer } from "@/server/http/container";
import { handleRunDocumentGet } from "@/server/http/document-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunDocumentGet(request, await context.params, getHttpContainer());
}
