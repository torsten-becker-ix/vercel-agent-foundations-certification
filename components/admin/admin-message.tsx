import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { AdminMessagePart, AdminUIMessage } from "@/lib/admin/chat-types";
import { answerTextIndexes } from "@/lib/chat-visibility";

import {
  type AdminToolPart,
  AdminToolPart as ToolPart,
} from "./admin-tool-part";

function isAdminToolPart(part: AdminMessagePart): part is AdminToolPart {
  return part.type.startsWith("tool-");
}

function Part({
  part,
  role,
  isAnswer,
  isStreaming,
}: {
  part: AdminMessagePart;
  role: AdminUIMessage["role"];
  /** False for assistant text written alongside tool calls (see chat-visibility). */
  isAnswer: boolean;
  isStreaming: boolean;
}) {
  if (part.type === "text") {
    if (part.text.trim() === "" || (role === "assistant" && !isAnswer)) {
      return null;
    }
    return role === "assistant" ? (
      // skipHtml: raw HTML in model output is dropped, never rendered.
      <MessageResponse skipHtml>{part.text}</MessageResponse>
    ) : (
      <p className="whitespace-pre-wrap">{part.text}</p>
    );
  }
  if (isAdminToolPart(part)) {
    return <ToolPart isStreaming={isStreaming} part={part} />;
  }
  // Reasoning, step markers and other part types aren't shown.
  return null;
}

export function AdminMessage({
  message,
  isStreaming,
}: {
  message: AdminUIMessage;
  /** True while this message is still being generated. */
  isStreaming: boolean;
}) {
  const answer = answerTextIndexes(message);
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <Part
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
