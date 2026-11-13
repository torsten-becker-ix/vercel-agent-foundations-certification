import { type ModelCallStreamPart, WorkflowAgent } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";

import {
  SHOPPING_AGENT_INSTRUCTIONS,
  SHOPPING_AGENT_MAX_STEPS,
  SHOPPING_AGENT_MODEL,
  SHOPPING_AGENT_PROVIDER_OPTIONS,
  TOOL_APPROVAL_SECRET_ENV,
} from "../agent";
import { shoppingTools } from "../tools";
import {
  CHAT_FAILURE_MESSAGE,
  closeChatStream,
  writeChatFailure,
} from "./chat-stream";

/**
 * Durable shopping chat: one workflow run per user message. Every model call
 * and every tool call is a checkpointed step, so a retried or resumed run
 * continues from the last completed step instead of starting over.
 */
export async function shoppingChatFlow(messages: UIMessage[]) {
  "use workflow";

  const writable = getWritable<ModelCallStreamPart>();
  const agent = new WorkflowAgent({
    model: SHOPPING_AGENT_MODEL,
    instructions: SHOPPING_AGENT_INSTRUCTIONS,
    tools: shoppingTools,
    providerOptions: SHOPPING_AGENT_PROVIDER_OPTIONS,
    experimental_toolApprovalSecret: {
      environmentVariable: TOOL_APPROVAL_SECRET_ENV,
    },
  });

  try {
    const result = await agent.stream({
      // Drops tool calls without a result (e.g. the shopper pressed Stop while a
      // tool ran). Kept, they fail every later run (MissingToolResultsError).
      messages: await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      }),
      writable,
      stopWhen: isStepCount(SHOPPING_AGENT_MAX_STEPS),
      // We close the stream ourselves (below), so a failure can still be
      // reported to the client before the stream ends.
      preventClose: true,
    });
    return { messages: result.messages };
  } catch (error) {
    await writeChatFailure(writable, CHAT_FAILURE_MESSAGE);
    // Re-throw so the run is recorded as failed (dashboard, logs).
    throw error;
  } finally {
    await closeChatStream(writable);
  }
}
