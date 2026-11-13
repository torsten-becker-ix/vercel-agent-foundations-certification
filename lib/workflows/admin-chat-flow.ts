import { type ModelCallStreamPart, WorkflowAgent } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";

import {
  ADMIN_AGENT_MAX_STEPS,
  ADMIN_AGENT_MODEL,
  ADMIN_AGENT_PROVIDER_OPTIONS,
  adminInstructions,
} from "../admin/agent";
import { memoryForPrompt, readMemory } from "../admin/memory";
import { adminTools } from "../admin/tools";
import {
  CHAT_FAILURE_MESSAGE,
  closeChatStream,
  type StepBudget,
  streamWithRecovery,
  writeChatFailure,
} from "./chat-stream";

/**
 * Reads the memory file from the admin sandbox at the start of the run (app
 * code, not a tool), so every conversation starts with the saved context.
 * Null when nothing is saved yet or the sandbox is unavailable.
 */
async function loadMemoryStep(): Promise<string | null> {
  "use step";
  return memoryForPrompt(await readMemory());
}

type AdminToolName = keyof typeof adminTools;
const CATALOG_TOOLS: AdminToolName[] = ["searchProducts", "getAllCategories"];
const MAX_CATALOG_CALLS = 3;

/**
 * Step guards (deterministic, run in the workflow):
 * - The last allowed step has no tools, so the run always ends with an answer
 *   instead of hitting the step limit mid-analysis.
 * - After a few catalog lookups, the catalog tools are switched off.
 * gpt-oss workaround: it ran 11 product searches for names it already had
 * and used up all steps without answering.
 */
function prepareAdminStep(
  budget: StepBudget,
  {
    stepNumber,
    steps,
  }: {
    stepNumber: number;
    steps: { toolCalls: { toolName: string }[] }[];
  },
) {
  // Counted across the recovery attempts of the same run.
  if (budget.stepsUsed + stepNumber >= ADMIN_AGENT_MAX_STEPS - 1) {
    return { toolChoice: "none" as const };
  }
  const catalogCalls = [
    ...budget.toolNames,
    ...steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
  ].filter((name) => CATALOG_TOOLS.includes(name as AdminToolName)).length;
  if (catalogCalls >= MAX_CATALOG_CALLS) {
    return {
      activeTools: (Object.keys(adminTools) as AdminToolName[]).filter(
        (name) => !CATALOG_TOOLS.includes(name),
      ),
    };
  }
  return undefined;
}

/**
 * Durable admin chat: one workflow run per employee message, like the
 * shopping chat. Every model call and tool call is a checkpointed step.
 */
export async function adminChatFlow(messages: UIMessage[]) {
  "use workflow";

  const writable = getWritable<ModelCallStreamPart>();
  const memory = await loadMemoryStep();
  const agent = new WorkflowAgent({
    model: ADMIN_AGENT_MODEL,
    // Workflow time is deterministic (the run's start), so replays agree.
    instructions: adminInstructions(memory, new Date()),
    tools: adminTools,
    providerOptions: ADMIN_AGENT_PROVIDER_OPTIONS,
  });

  try {
    const result = await streamWithRecovery(
      async ({ budget, ...attempt }) =>
        agent.stream({
          ...attempt,
          writable,
          stopWhen: isStepCount(ADMIN_AGENT_MAX_STEPS - budget.stepsUsed),
          prepareStep: (info) => prepareAdminStep(budget, info),
          preventClose: true,
        }),
      // Drops tool calls without a result (Stop during a tool call).
      await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      }),
      ADMIN_AGENT_MAX_STEPS,
    );
    return { messages: result.messages };
  } catch (error) {
    await writeChatFailure(writable, CHAT_FAILURE_MESSAGE);
    throw error;
  } finally {
    await closeChatStream(writable);
  }
}
