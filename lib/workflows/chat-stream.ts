import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import type { ModelMessage } from "ai";

/**
 * Stream steps shared by the shopping and the admin chat workflows.
 */

/** Shown when a chat run fails for good (no internals). */
export const CHAT_FAILURE_MESSAGE =
  "Sorry, something went wrong while answering. Please try again.";

/**
 * Writes an `error` part into the durable stream. It becomes a UI `error`
 * chunk, so the client shows a failure (instead of an empty answer) and a
 * reconnect replays it too.
 */
export async function writeChatFailure(
  writable: WritableStream<ModelCallStreamPart>,
  message: string,
) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "error", error: message });
  } finally {
    writer.releaseLock();
  }
}

/** Closes the durable stream; the client then receives its final `finish`. */
export async function closeChatStream(
  writable: WritableStream<ModelCallStreamPart>,
) {
  "use step";
  await writable.close();
}

/** Attempts per run when the model stream fails (see `streamWithRecovery`). */
export const MODEL_STREAM_ATTEMPTS = 3;

/** Model-only nudge when a run ends without an answer (not shown in the UI). */
export const ANSWER_NUDGE =
  "Write your final answer for the user now, based on the results above.";

interface StreamResultLike {
  messages: ModelMessage[];
  steps: { text: string; toolCalls: readonly { toolName: string }[] }[];
}

/** What earlier attempts of the same run already used. */
export interface StepBudget {
  /** Model steps used by earlier attempts (count against the run's limit). */
  stepsUsed: number;
  /** Tool names called by earlier attempts. */
  toolNames: string[];
}

/** The last step wrote no text and called no tools: the turn has no answer. */
function endedWithoutAnswer(result: StreamResultLike): boolean {
  const last = result.steps.at(-1);
  return last?.toolCalls.length === 0 && last.text.trim() === "";
}

/**
 * Runs `agent.stream` and recovers from two gpt-oss failure modes instead of
 * ending the run (gpt-oss workaround, both seen 2026-11-13):
 *
 * - The model stream fails mid-run (the provider couldn't parse a tool call:
 *   "Failed to parse tool call arguments as JSON", about 3 in 10 complex admin
 *   runs). The run continues from the conversation so far, up to
 *   `MODEL_STREAM_ATTEMPTS`; completed tool calls are kept, the failed step's
 *   partial assistant message is dropped (it may hold a tool call without a
 *   result, or text the client already discarded). `WorkflowAgent` doesn't
 *   retry this itself (its model step has `maxRetries = 0`; it reports the
 *   error via `onError` and returns normally). The raw error part is held
 *   back from the client by the chat routes (`dropModelErrors`). After the
 *   last attempt this throws, and the caller writes `CHAT_FAILURE_MESSAGE`.
 * - The turn ends with reasoning only, no answer text. It continues once with
 *   a model-only nudge (`ANSWER_NUDGE`).
 *
 * `maxSteps` is the run's total: every attempt gets the remaining budget.
 */
export async function streamWithRecovery<TResult extends StreamResultLike>(
  stream: (options: {
    messages: ModelMessage[];
    onError: (event: { error: unknown }) => void;
    budget: StepBudget;
  }) => Promise<TResult>,
  messages: ModelMessage[],
  maxSteps: number,
): Promise<TResult> {
  let conversation = messages;
  let nudged = false;
  const budget: StepBudget = { stepsUsed: 0, toolNames: [] };
  for (let attempt = 1; ; attempt++) {
    let failure: { error: unknown } | undefined;
    const result = await stream({
      messages: conversation,
      onError: (event) => {
        failure = event;
      },
      budget: { stepsUsed: budget.stepsUsed, toolNames: [...budget.toolNames] },
    });
    budget.stepsUsed += result.steps.length;
    budget.toolNames.push(
      ...result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      ),
    );
    const outOfSteps = budget.stepsUsed >= maxSteps;
    // The instructions are re-added by the agent; system messages in
    // `messages` are rejected.
    const soFar = result.messages.filter(
      (message) => message.role !== "system",
    );
    if (failure === undefined) {
      if (nudged || outOfSteps || !endedWithoutAnswer(result)) return result;
      nudged = true;
      conversation = [...soFar, { role: "user", content: ANSWER_NUDGE }];
      continue;
    }
    if (attempt >= MODEL_STREAM_ATTEMPTS || outOfSteps) throw failure.error;
    // Drop the failed step's partial assistant message (completed steps end
    // with their tool results, so they are kept).
    conversation =
      soFar.at(-1)?.role === "assistant" ? soFar.slice(0, -1) : soFar;
  }
}
