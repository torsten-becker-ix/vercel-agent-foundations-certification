import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, safeValidateUIMessages } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import { shoppingChatFlow } from "@/lib/workflows/chat-flow";

/** Guards against oversized histories (cost) — the client sends the full conversation. */
const MAX_MESSAGES = 100;

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

/**
 * Starts one durable chat run per user message and streams it back as UI
 * message chunks. The `x-workflow-run-id` header lets `WorkflowChatTransport`
 * reconnect via `GET /api/chat/[id]/stream`.
 */
export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = bodySchema.safeParse(json);
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
