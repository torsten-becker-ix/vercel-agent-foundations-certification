import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { ShoppingMessagePart, ShoppingUIMessage } from "@/lib/chat-types";
import { answerTextIndexes } from "@/lib/chat-visibility";

import { ToolStatus } from "./tool-status";

function MessagePart({
  part,
  role,
  isAnswer,
  isStreaming,
}: {
  part: ShoppingMessagePart;
  role: ShoppingUIMessage["role"];
  /** False for assistant text written alongside tool calls (see chat-visibility). */
  isAnswer: boolean;
  isStreaming: boolean;
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
      return <ToolStatus isStreaming={isStreaming} part={part} />;
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

export function ChatMessage({
  message,
  isStreaming,
}: {
  message: ShoppingUIMessage;
  /** True while this message is still being generated. */
  isStreaming: boolean;
}) {
  const answer = answerTextIndexes(message);
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
            role={message.role}
          />
        ))}
      </MessageContent>
    </Message>
  );
}
