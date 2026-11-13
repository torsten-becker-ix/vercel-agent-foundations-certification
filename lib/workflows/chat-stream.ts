import type { ModelCallStreamPart } from "@ai-sdk/workflow";

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
