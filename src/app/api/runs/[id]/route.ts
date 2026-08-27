import { getHttpContainer } from "@/server/http/container";
import {
  handleRunDelete,
  handleRunGet,
} from "@/server/http/run-detail-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunGet(request, await context.params, getHttpContainer());
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunDelete(request, await context.params, getHttpContainer());
}
