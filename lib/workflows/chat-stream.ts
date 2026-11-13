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

/**
 * Runs `agent.stream` and, when the model stream fails mid-run (e.g. the
 * provider couldn't parse a tool call: "Failed to parse tool call arguments
 * as JSON"), continues from the conversation so far instead of ending the
 * run. Completed tool calls are kept, so nothing is repeated.
 *
 * `WorkflowAgent` doesn't retry these itself: its model step has
 * `maxRetries = 0`, and it reports the error through `onError` and returns
 * normally. The raw error part it writes is held back from the client by the
 * chat routes (`dropModelErrors`); after the last attempt this throws, and
 * the caller writes `CHAT_FAILURE_MESSAGE`.
 *
 * gpt-oss workaround: it intermittently produced tool calls the provider
 * couldn't parse (about 3 in 10 complex admin runs, 2026-11-13).
 */
export async function streamWithRecovery<
  TResult extends { messages: ModelMessage[] },
>(
  stream: (options: {
    messages: ModelMessage[];
    onError: (event: { error: unknown }) => void;
  }) => Promise<TResult>,
  messages: ModelMessage[],
): Promise<TResult> {
  let conversation = messages;
  for (let attempt = 1; ; attempt++) {
    let failure: { error: unknown } | undefined;
    const result = await stream({
      messages: conversation,
      onError: (event) => {
        failure = event;
      },
    });
    if (failure === undefined) return result;
    if (attempt >= MODEL_STREAM_ATTEMPTS) throw failure.error;
    // The instructions are re-added by the agent; system messages in
    // `messages` are rejected.
    conversation = result.messages.filter(
      (message) => message.role !== "system",
    );
  }
}
