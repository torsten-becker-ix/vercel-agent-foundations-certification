import { type ChatStatus, isToolUIPart, type UIMessage } from "ai";

/** True while the assistant is working but nothing new is visible yet. */
export function isThinking(status: ChatStatus, messages: UIMessage[]): boolean {
  if (status === "submitted") return true;
  if (status !== "streaming") return false;
  const last = messages.at(-1);
  if (last?.role !== "assistant") return true;
  const visible = last.parts.filter(
    (part) =>
      (part.type === "text" && part.text.trim() !== "") || isToolUIPart(part),
  );
  const latest = visible.at(-1);
  // Nothing shown yet, or a tool just finished and the answer hasn't started.
  return (
    latest === undefined ||
    (isToolUIPart(latest) && latest.state === "output-available")
  );
}
