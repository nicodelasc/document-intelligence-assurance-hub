import { getHttpContainer } from "@/server/http/container";
import { handleStageActionPost } from "@/server/http/stage-action-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleStageActionPost(
    request,
    await context.params,
    getHttpContainer(),
  );
}
