"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { type ChatTransport, isToolUIPart } from "ai";
import { AlertCircleIcon, RotateCcwIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { ChatMessage } from "@/components/shopping/chat-message";
import { Button } from "@/components/ui/button";
import { announcementText } from "@/lib/chat-announcement";
import type { ShoppingUIMessage } from "@/lib/chat-types";

const SUGGESTIONS = [
  "What categories do you have?",
  "Show me hoodies",
  "Do you have a water bottle?",
];

/** True while the assistant is working but nothing new is visible yet. */
function isThinking(
  status: ReturnType<typeof useChat>["status"],
  messages: ShoppingUIMessage[],
): boolean {
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

/** One conversation. Remounted (via `key`) to start a new chat. */
function ChatSession({ onNewChat }: { onNewChat: () => void }) {
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [transport] = useState(
    () =>
      // Type-only cast: under `exactOptionalPropertyTypes`, @ai-sdk/workflow's
      // `messageId?: string` doesn't accept the `string | undefined` that `ai`
      // passes. Runtime contract is identical (see CLAUDE.md exceptions).
      new WorkflowChatTransport<ShoppingUIMessage>({
        api: "/api/chat",
        maxConsecutiveErrors: 5,
      }) as unknown as ChatTransport<ShoppingUIMessage>,
  );

  const { messages, sendMessage, status, stop, regenerate } =
    useChat<ShoppingUIMessage>({
      transport,
      onFinish: ({ message, isAbort, isError }) => {
        if (isAbort || isError) return;
        const text = announcementText(message);
        setAnnouncement(text === "" ? "The assistant replied." : text);
      },
    });

  const isBusy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || isBusy) return;
    setAnnouncement("");
    void sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => {
    send(message.text);
  };

  const handleRetry = () => {
    setAnnouncement("");
    void regenerate();
  };

  const handleNewChat = () => {
    void stop();
    onNewChat();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length > 0 ? (
        <div className="flex justify-end border-b px-2 py-1">
          <Button
            onClick={handleNewChat}
            size="sm"
            type="button"
            variant="ghost"
          >
            <SquarePenIcon aria-hidden="true" />
            New chat
          </Button>
        </div>
      ) : null}

      {/* The log itself is not live (it would announce every streamed token);
          finished replies and errors are announced once, below. */}
      <Conversation
        aria-label="Conversation"
        aria-live="off"
        className="flex-1"
      >
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Ask about products, sizes, stock, or prices."
              title="How can I help you shop?"
            />
          ) : (
            messages.map((message, index) => (
              <ChatMessage
                isStreaming={isBusy ? index === messages.length - 1 : false}
                key={message.id}
                message={message}
              />
            ))
          )}

          {isThinking(status, messages) ? (
            <p className="text-sm">
              <Shimmer as="span" duration={1.5}>
                Thinking…
              </Shimmer>
            </p>
          ) : null}

          {/* role="alert" announces the failure; no separate status message. */}
          {status === "error" ? (
            <div
              className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <p className="flex items-center gap-2 text-destructive">
                <AlertCircleIcon aria-hidden="true" className="size-4" />
                Sorry, something went wrong while answering.
              </p>
              <Button
                onClick={handleRetry}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcwIcon aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 ? (
          <Suggestions>
            {SUGGESTIONS.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={send}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        ) : null}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="Message the shopping assistant"
              onChange={(event) => {
                setInput(event.currentTarget.value);
              }}
              placeholder="Ask about our products…"
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              disabled={!isBusy && input.trim() === ""}
              onStop={() => {
                void stop();
              }}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

/**
 * Storefront shopping chat. Uses `WorkflowChatTransport`, so an interrupted
 * stream reconnects to the same durable run instead of starting a new one.
 */
export function AgentChat() {
  const [session, setSession] = useState(0);
  return (
    <ChatSession
      key={session}
      onNewChat={() => {
        setSession((current) => current + 1);
      }}
    />
  );
}
