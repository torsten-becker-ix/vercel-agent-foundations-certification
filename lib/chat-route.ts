import "server-only";

import {
  createModelCallToUIChunkTransform,
  type ModelCallStreamPart,
} from "@ai-sdk/workflow";
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { getRun, start } from "workflow/api";
import { z } from "zod";

import { isForeignOrigin, readJsonBody } from "@/lib/request-guard";
import { CHAT_FAILURE_MESSAGE } from "@/lib/workflows/chat-stream";
import { isRunOfWorkflow, isWorkflowRunId } from "@/lib/workflow-run-id";

/**
 * Route logic shared by the shopping chat (`/api/chat`) and the admin chat
 * (`/api/admin/chat`): one durable workflow run per message, streamed as UI
 * message chunks, plus the resume route. Auth is the caller's job.
 */

/** Guards against oversized histories (cost) — the client sends the full conversation. */
const MAX_MESSAGES = 100;
/** ~10× a long real conversation with product cards; caps tokens per run. */
const MAX_BODY_BYTES = 1_000_000;

const bodySchema = z.object({
  // Only user and assistant turns: the system prompt is the server's.
  messages: z
    .array(z.looseObject({ role: z.enum(["user", "assistant"]) }))
    .min(1)
    .max(MAX_MESSAGES),
});

/**
 * Holds back the model's own `error` parts: the workflow retries a failed
 * model stream (`streamWithRecovery`) and reports a final failure with
 * `CHAT_FAILURE_MESSAGE`, which passes. Without this, the client would stop
 * reading at the first error and miss the retried answer.
 *
 * Filters the raw durable stream, before the UI transform, so the UI chunk
 * indexes on the server and the client stay equal (a reconnect with
 * `startIndex=N` resumes exactly where the client stopped).
 */
function dropModelErrors() {
  return new TransformStream<ModelCallStreamPart, ModelCallStreamPart>({
    transform(part, controller) {
      if (part.type === "error" && part.error !== CHAT_FAILURE_MESSAGE) {
        console.warn(
          "[chat] model stream error (retried by the run):",
          part.error,
        );
        return;
      }
      controller.enqueue(part);
    },
  });
}

/**
 * Starts one run of `workflow` for the posted conversation. The
 * `x-workflow-run-id` header lets `WorkflowChatTransport` reconnect via the
 * resume route.
 */
export async function startChatRun(
  request: Request,
  workflow: (messages: UIMessage[]) => Promise<unknown>,
): Promise<Response> {
  const read = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!read.ok) return read.response;

  const body = bodySchema.safeParse(read.json);
  if (!body.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const validated = await safeValidateUIMessages({
    messages: body.data.messages,
  });
  if (!validated.success) {
    return Response.json({ error: "invalid_messages" }, { status: 400 });
  }

  const run = await start(workflow, [validated.data]);

  return createUIMessageStreamResponse({
    stream: run.readable
      .pipeThrough(dropModelErrors())
      .pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}

/**
 * Reconnects to a running (or finished) chat run, used by
 * `WorkflowChatTransport` after a dropped connection or a page refresh.
 *
 * `startIndex` counts UI chunks the client already has, while the durable
 * stream stores raw model parts. So the raw stream is replayed from 0 and the
 * transform skips the first `startIndex` UI chunks: no duplicate output, and
 * no new run is started.
 *
 * Only runs of `exportName` stream here (the id comes from the client); any
 * other run gets the same 404 as an unknown id.
 */
export async function resumeChatRun(
  request: Request,
  id: string,
  exportName: "shoppingChatFlow" | "adminChatFlow",
): Promise<Response> {
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
  if (
    !(await run.exists) ||
    !isRunOfWorkflow(await run.workflowName, exportName)
  ) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }

  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(dropModelErrors())
      .pipeThrough(
        createModelCallToUIChunkTransform({ uiStartIndex: startIndex }),
      ),
    headers: { "x-workflow-run-id": id },
  });
}

/**
 * Cancels a chat run when the user presses Stop or starts a new chat, so the
 * durable run doesn't keep calling the model, tools or the sandbox unseen.
 * Same checks as resume (id format, workflow kind), plus same-origin.
 */
export async function cancelChatRun(
  request: Request,
  id: string,
  exportName: "shoppingChatFlow" | "adminChatFlow",
): Promise<Response> {
  if (isForeignOrigin(request)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }
  if (!isWorkflowRunId(id)) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }
  const run = getRun(id);
  if (
    !(await run.exists) ||
    !isRunOfWorkflow(await run.workflowName, exportName)
  ) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }
  const status = await run.status;
  if (status === "pending" || status === "running") {
    await run.cancel({ cancelReason: "Stopped by the user" });
  }
  return new Response(null, { status: 204 });
}
