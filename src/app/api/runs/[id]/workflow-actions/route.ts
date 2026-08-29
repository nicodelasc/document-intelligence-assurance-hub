import { getHttpContainer } from "@/server/http/container";
import { handleWorkflowActionPost } from "@/server/http/workflow-action-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleWorkflowActionPost(
    request,
    await context.params,
    getHttpContainer(),
  );
}
