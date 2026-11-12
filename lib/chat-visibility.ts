import { isToolUIPart, type UIMessage } from "ai";

/**
 * Indexes of the text parts that count as the assistant's answer.
 *
 * A message is split into model steps at `step-start` parts. Text written in a
 * step that also calls tools was produced before the tool results existed
 * (gpt-oss workaround: gpt-oss-120b guessed there, e.g. an invented product
 * and price), so only text from steps without
 * tool calls is shown. The final answer is always such a step.
 */
export function answerTextIndexes(
  message: Pick<UIMessage, "parts">,
): Set<number> {
  const visible = new Set<number>();
  let stepText: number[] = [];
  let stepHasTool = false;

  const closeStep = () => {
    if (!stepHasTool) for (const index of stepText) visible.add(index);
    stepText = [];
    stepHasTool = false;
  };

  message.parts.forEach((part, index) => {
    if (part.type === "step-start") closeStep();
    else if (part.type === "text") stepText.push(index);
    else if (isToolUIPart(part)) stepHasTool = true;
  });
  closeStep();
  return visible;
}
