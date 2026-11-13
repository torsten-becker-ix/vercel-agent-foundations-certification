import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { getRun } from "workflow/api";

import { isRunOfWorkflow, isWorkflowRunId } from "@/lib/workflow-run-id";

/**
 * Reconnects to a running (or finished) chat run, used by
 * `WorkflowChatTransport` after a dropped connection or a page refresh.
 *
 * `startIndex` counts UI chunks the client already has, while the durable
 * stream stores raw model parts. So the raw stream is replayed from 0 and the
 * transform skips the first `startIndex` UI chunks: no duplicate output, and
 * no new run is started.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isWorkflowRunId(id)) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }

  const startIndex = Number(
    new URL(request.url).searchParams.get("startIndex") ?? "0",
  );
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "invalid_start_index" }, { status: 400 });
  }

  const run = getRun(id);
  // Only shopping chat runs: this route is public, so a return or (later)
  // admin run id must not stream here. Same 404 as for an unknown id.
  if (
    !(await run.exists) ||
    !isRunOfWorkflow(await run.workflowName, "shoppingChatFlow")
  ) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }

  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(
        createModelCallToUIChunkTransform({ uiStartIndex: startIndex }),
      ),
    headers: { "x-workflow-run-id": id },
  });
}
