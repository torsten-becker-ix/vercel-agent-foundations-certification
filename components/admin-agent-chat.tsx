"use client";

// First: configures zod before `ai` builds its schemas (see the module).
import "@/lib/zod-jitless";

import { SquarePenIcon } from "lucide-react";
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
import { AdminMessage } from "@/components/admin/admin-message";
import { ChatNotices } from "@/components/chat/chat-notices";
import { PersistentChatRoot } from "@/components/chat/persistent-chat-root";
import { Button } from "@/components/ui/button";
import {
  type PersistentChatSessionProps,
  usePersistentChat,
} from "@/hooks/use-persistent-chat";
import type { AdminUIMessage } from "@/lib/admin/chat-types";
import { announcementText } from "@/lib/chat-announcement";
import { ADMIN_CHAT_KEY, createChatStore } from "@/lib/chat-storage";
import { isThinking } from "@/lib/chat-thinking";

const SUGGESTIONS = [
  "Which products are low on stock?",
  "Which products had the highest return rates in the last 30 days?",
  "Summarize revenue for the last 7 days",
  "Show open urgent support tickets",
];

const CHAT_API = "/api/admin/chat";
const store = createChatStore<AdminUIMessage>(ADMIN_CHAT_KEY);

function ChatSession(props: PersistentChatSessionProps) {
  const { onReconnect } = props;
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    disconnected,
    newChat,
  } = usePersistentChat<AdminUIMessage>({
    ...props,
    api: CHAT_API,
    store,
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length > 0 ? (
        <div className="flex justify-end border-b px-2 py-1">
          <Button onClick={newChat} size="sm" type="button" variant="ghost">
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
              description="Ask about support tickets, returns, inventory, or sales."
              title="What do you want to look into?"
            />
          ) : (
            messages.map((message, index) => (
              <AdminMessage
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

          <ChatNotices
            disconnected={disconnected}
            isError={status === "error"}
            onReconnect={onReconnect}
            onRetry={() => {
              setAnnouncement("");
              void regenerate();
            }}
          />
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to the latest message" />
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
              aria-label="Message the admin agent"
              onChange={(event) => {
                setInput(event.currentTarget.value);
              }}
              placeholder="Ask the admin agent…"
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
 * Back-office chat at `/admin`: its own agent, route and conversation (never
 * the shopping agent's). Durable runs, resumable after a refresh.
 */
export function AdminAgentChat() {
  return (
    <PersistentChatRoot>
      {(props) => <ChatSession {...props} />}
    </PersistentChatRoot>
  );
}
