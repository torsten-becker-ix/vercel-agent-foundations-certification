"use client";

// First: configures zod before `ai` builds its schemas (see the module).
import "@/lib/zod-jitless";

import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
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
import { ChatNotices } from "@/components/chat/chat-notices";
import { PersistentChatRoot } from "@/components/chat/persistent-chat-root";
import {
  type ChatActions,
  ChatActionsProvider,
} from "@/components/shopping/chat-actions";
import { ChatMessage } from "@/components/shopping/chat-message";
import { Button } from "@/components/ui/button";
import {
  type PersistentChatSessionProps,
  usePersistentChat,
} from "@/hooks/use-persistent-chat";
import { announcementText } from "@/lib/chat-announcement";
import { createChatStore, SHOPPING_CHAT_KEY } from "@/lib/chat-storage";
import { isThinking } from "@/lib/chat-thinking";
import type { ShoppingUIMessage } from "@/lib/chat-types";

const SUGGESTIONS = [
  "What categories do you have?",
  "Show me hoodies",
  "Do you have a water bottle?",
];

/** True when the reply ends with a return waiting for Approve/Deny. */
function awaitsApproval(message: ShoppingUIMessage): boolean {
  return message.parts.some(
    (part) => isToolUIPart(part) && part.state === "approval-requested",
  );
}

const CHAT_API = "/api/chat";
const store = createChatStore<ShoppingUIMessage>(SHOPPING_CHAT_KEY);

/** Focus target when the agent panel opens. */
export const CHAT_INPUT_ID = "agent-chat-input";

/**
 * One conversation. Remounted (via `key`) to start a new chat, or to
 * reconnect after the connection was lost.
 *
 * With `restore`, it starts from the chat saved in `localStorage` and, if an
 * answer was still streaming, reconnects to that run.
 */
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
    addToolApprovalResponse,
    disconnected,
    newChat,
  } = usePersistentChat<ShoppingUIMessage>({
    ...props,
    api: CHAT_API,
    store,
    // After Approve/Deny, send the conversation again: the next run executes
    // (or skips) the approved tool before calling the model.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message, isAbort, isError }) => {
      if (isAbort || isError) return;
      if (awaitsApproval(message)) {
        setAnnouncement(
          "Please confirm the return with the Approve or Deny button.",
        );
        return;
      }
      const text = announcementText(message);
      setAnnouncement(text === "" ? "The assistant replied." : text);
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  const actions: ChatActions = {
    isBusy,
    send: (text) => {
      send(text);
    },
    respondToApproval: (approvalId, approved) => {
      setAnnouncement("");
      void addToolApprovalResponse(
        approved
          ? { id: approvalId, approved }
          : // gpt-oss workaround: without a reason, gpt-oss read the denial as
            // "please confirm" and asked again. The reason reaches the model.
            {
              id: approvalId,
              approved,
              reason:
                "The shopper declined. Nothing was filed. Acknowledge it and don't ask to confirm again.",
            },
      );
    },
  };

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

  return (
    <ChatActionsProvider value={actions}>
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
                description="Ask about products, sizes, stock, or prices."
                title="How can I help you shop?"
              />
            ) : (
              messages.map((message, index) => (
                <ChatMessage
                  isLatest={index === messages.length - 1}
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
              onRetry={handleRetry}
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
                aria-label="Message the shopping assistant"
                id={CHAT_INPUT_ID}
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
    </ChatActionsProvider>
  );
}

/**
 * Storefront shopping chat. Uses `WorkflowChatTransport`, so an interrupted
 * stream reconnects to the same durable run instead of starting a new one.
 * The conversation survives a page refresh via `localStorage`.
 */
export function AgentChat() {
  return (
    <PersistentChatRoot>
      {(props) => <ChatSession {...props} />}
    </PersistentChatRoot>
  );
}
