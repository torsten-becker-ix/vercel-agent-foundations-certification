import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, safeValidateUIMessages } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import { readJsonBody } from "@/lib/request-guard";
import { shoppingChatFlow } from "@/lib/workflows/chat-flow";

/** Guards against oversized histories (cost) — the client sends the full conversation. */
const MAX_MESSAGES = 100;
/** ~10× a long real conversation with product cards; caps tokens per run. */
const MAX_BODY_BYTES = 1_000_000;

const bodySchema = z.object({
  // Only shopper and assistant turns: the system prompt is the server's.
  messages: z
    .array(z.looseObject({ role: z.enum(["user", "assistant"]) }))
    .min(1)
    .max(MAX_MESSAGES),
});

/**
 * Starts one durable chat run per user message and streams it back as UI
 * message chunks. The `x-workflow-run-id` header lets `WorkflowChatTransport`
 * reconnect via `GET /api/chat/[id]/stream`.
 */
export async function POST(request: Request): Promise<Response> {
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

  const run = await start(shoppingChatFlow, [validated.data]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
