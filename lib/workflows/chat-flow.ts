import { type ModelCallStreamPart, WorkflowAgent } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";

import {
  SHOPPING_AGENT_INSTRUCTIONS,
  SHOPPING_AGENT_MAX_STEPS,
  SHOPPING_AGENT_MODEL,
} from "../agent";
import { shoppingTools } from "../tools";

/**
 * Durable shopping chat: one workflow run per user message. Every model call
 * and every tool call is a checkpointed step, so a retried or resumed run
 * continues from the last completed step instead of starting over.
 */
export async function shoppingChatFlow(messages: UIMessage[]) {
  "use workflow";

  const agent = new WorkflowAgent({
    model: SHOPPING_AGENT_MODEL,
    instructions: SHOPPING_AGENT_INSTRUCTIONS,
    tools: shoppingTools,
  });

  const result = await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<ModelCallStreamPart>(),
    stopWhen: isStepCount(SHOPPING_AGENT_MAX_STEPS),
  });

  return { messages: result.messages };
}
