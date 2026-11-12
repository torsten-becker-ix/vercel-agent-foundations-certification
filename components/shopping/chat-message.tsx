import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { ShoppingMessagePart, ShoppingUIMessage } from "@/lib/chat-types";
import { answerTextIndexes } from "@/lib/chat-visibility";

import { ToolPart } from "./tool-part";

function MessagePart({
  part,
  role,
  isAnswer,
  isStreaming,
  shownBefore,
}: {
  part: ShoppingMessagePart;
  role: ShoppingUIMessage["role"];
  /** False for assistant text written alongside tool calls (see chat-visibility). */
  isAnswer: boolean;
  isStreaming: boolean;
  shownBefore: ReadonlySet<string>;
}) {
  switch (part.type) {
    case "text":
      if (part.text.trim() === "" || (role === "assistant" && !isAnswer)) {
        return null;
      }
      return role === "assistant" ? (
        // skipHtml: raw HTML in model output is dropped, never rendered.
        <MessageResponse skipHtml>{part.text}</MessageResponse>
      ) : (
        <p className="whitespace-pre-wrap">{part.text}</p>
      );
    case "tool-getAllCategories":
    case "tool-searchProducts":
    case "tool-getProductDetails":
      return (
        <ToolPart
          isStreaming={isStreaming}
          part={part}
          shownBefore={shownBefore}
        />
      );
    // Reasoning is the model's scratchpad, not an answer: not shown to
    // shoppers (the chat shows a "Thinking…" indicator instead).
    case "reasoning":
    case "step-start":
    case "dynamic-tool":
    case "source-url":
    case "source-document":
    case "file":
    case "custom":
    case "reasoning-file":
    case "steering-message":
      return null;
  }
}

const NONE: ReadonlySet<string> = new Set();

/**
 * For each search-result part: the product ids an earlier search in the same
 * reply already showed, so repeated searches don't repeat cards.
 */
function productsShownBefore(
  message: ShoppingUIMessage,
): Map<number, ReadonlySet<string>> {
  const result = new Map<number, ReadonlySet<string>>();
  const seen = new Set<string>();
  message.parts.forEach((part, index) => {
    if (
      part.type === "tool-searchProducts" &&
      part.state === "output-available" &&
      part.output.status === "ok"
    ) {
      result.set(index, new Set(seen));
      for (const product of part.output.products) seen.add(product.id);
    }
  });
  return result;
}

export function ChatMessage({
  message,
  isStreaming,
}: {
  message: ShoppingUIMessage;
  /** True while this message is still being generated. */
  isStreaming: boolean;
}) {
  const answer = answerTextIndexes(message);
  const shownBefore = productsShownBefore(message);
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <MessagePart
            // Parts are append-only and have no ids of their own.
            // eslint-disable-next-line react/no-array-index-key -- stable position within an append-only list
            key={index}
            isAnswer={answer.has(index)}
            isStreaming={isStreaming}
            part={part}
            shownBefore={shownBefore.get(index) ?? NONE}
            role={message.role}
          />
        ))}
      </MessageContent>
    </Message>
  );
}
