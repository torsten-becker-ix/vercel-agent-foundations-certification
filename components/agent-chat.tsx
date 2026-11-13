"use client";

// First: configures zod before `ai` builds its schemas (see the module).
import "@/lib/zod-jitless";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import {
  type ChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  AlertCircleIcon,
  RotateCcwIcon,
  SquarePenIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

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
import {
  type ChatActions,
  ChatActionsProvider,
} from "@/components/shopping/chat-actions";
import { ChatMessage } from "@/components/shopping/chat-message";
import { Button } from "@/components/ui/button";
import { announcementText } from "@/lib/chat-announcement";
import { clearChat, EMPTY_CHAT, loadChat, saveChat } from "@/lib/chat-storage";
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

/** True when the reply ends with a return waiting for Approve/Deny. */
function awaitsApproval(message: ShoppingUIMessage): boolean {
  return message.parts.some(
    (part) => isToolUIPart(part) && part.state === "approval-requested",
  );
}

const CHAT_API = "/api/chat";

/**
 * `WorkflowChatTransport` POSTs a JSON string without a `Content-Type`, so the
 * browser sends `text/plain`, which `/api/chat` rejects (415, CSRF guard).
 */
const chatFetch: typeof fetch = async (input, init) => {
  if (init?.method !== "POST") return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(input, { ...init, headers });
};

/** Focus target when the agent panel opens. */
export const CHAT_INPUT_ID = "agent-chat-input";

/**
 * The chat transport plus the `localStorage` bookkeeping around it (see
 * `lib/chat-storage`). Plain closure state, not React state: it changes in
 * transport callbacks and is never rendered.
 */
function createPersistentChat(activeRunId: string | null) {
  /** The run of the latest answer; resume after a refresh reconnects to it. */
  let runId = activeRunId;
  /** Set by "New chat", so a late callback doesn't save the old chat again. */
  let discarded = false;

  // Type-only cast: under `exactOptionalPropertyTypes`, @ai-sdk/workflow's
  // `messageId?: string` doesn't accept the `string | undefined` that `ai`
  // passes. Runtime contract is identical (see CLAUDE.md exceptions).
  const transport = new WorkflowChatTransport<ShoppingUIMessage>({
    api: CHAT_API,
    fetch: chatFetch,
    maxConsecutiveErrors: 5,
    // The run has started: save what was sent plus its run id, before any of
    // the answer arrives. A refresh from here on resumes this run.
    onChatSendMessage: (response, { messages }) => {
      if (discarded) return;
      runId = response.headers.get("x-workflow-run-id");
      saveChat({ messages, activeRunId: runId });
    },
    // Resume after a refresh only knows the chat id; point it at the run.
    // (Reconnects within a request already use this same run id.)
    prepareReconnectToStreamRequest: ({ api }) => ({
      api:
        runId === null
          ? api
          : `${CHAT_API}/${encodeURIComponent(runId)}/stream`,
    }),
  }) as unknown as ChatTransport<ShoppingUIMessage>;

  return {
    transport,
    /** A run's answer is stored as unfinished and can be resumed. */
    hasActiveRun: () => runId !== null && !discarded,
    /** The answer is complete (or stopped): nothing left to resume. */
    answerEnded: (messages: ShoppingUIMessage[]) => {
      if (discarded) return;
      runId = null;
      saveChat({ messages, activeRunId: null });
    },
    discard: () => {
      discarded = true;
      clearChat();
    },
  };
}

/**
 * One conversation. Remounted (via `key`) to start a new chat, or to
 * reconnect after the connection was lost.
 *
 * With `restore`, it starts from the chat saved in `localStorage` and, if an
 * answer was still streaming, reconnects to that run.
 */
function ChatSession({
  restore,
  onNewChat,
  onReconnect,
}: {
  restore: boolean;
  onNewChat: () => void;
  onReconnect: () => void;
}) {
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  /** The connection dropped while a run's answer was still streaming. */
  const [disconnected, setDisconnected] = useState(false);
  const [saved] = useState(() => (restore ? loadChat() : EMPTY_CHAT));
  const [persistence] = useState(() => createPersistentChat(saved.activeRunId));

  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat<ShoppingUIMessage>({
    transport: persistence.transport,
    messages: saved.messages,
    // Only with a stored run: this transport throws on a resume without one.
    resume: saved.activeRunId !== null,
    // After Approve/Deny, send the conversation again: the next run executes
    // (or skips) the approved tool before calling the model.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message, messages: all, isAbort, isError, isDisconnect }) => {
      // On an error the run may still be going: keep the stored run id, so a
      // refresh or a reconnect resumes it (or "Try again" starts a new one).
      if (!isError && !isDisconnect) persistence.answerEnded(all);
      setDisconnected(isDisconnect && persistence.hasActiveRun());
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

  // Reconnect = remount from storage, exactly like a page refresh. Resuming in
  // place would replay the run from its start on top of the partial answer
  // (duplicates); the remount drops the partial answer and rebuilds it once.
  useEffect(() => {
    if (!disconnected) return;
    window.addEventListener("online", onReconnect);
    return () => {
      window.removeEventListener("online", onReconnect);
    };
  }, [disconnected, onReconnect]);

  const handleNewChat = () => {
    persistence.discard();
    void stop();
    onNewChat();
  };

  return (
    <ChatActionsProvider value={actions}>
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

            {/* role="alert" announces the failure; no separate status message. */}
            {status === "error" && disconnected ? (
              <div
                className="flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
                role="alert"
              >
                <p className="flex items-center gap-2">
                  <WifiOffIcon aria-hidden="true" className="size-4" />
                  Connection lost. The answer continues when you&apos;re back
                  online.
                </p>
                <Button
                  onClick={onReconnect}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcwIcon aria-hidden="true" />
                  Reconnect
                </Button>
              </div>
            ) : null}

            {status === "error" && !disconnected ? (
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

const subscribeToNothing = () => () => undefined;

/** False during SSR and hydration, true afterwards (no hydration mismatch). */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * Storefront shopping chat. Uses `WorkflowChatTransport`, so an interrupted
 * stream reconnects to the same durable run instead of starting a new one.
 * The conversation survives a page refresh via `localStorage`; the server
 * render starts empty and the client remounts with the saved chat.
 */
export function AgentChat() {
  const isClient = useIsClient();
  const [session, setSession] = useState(0);
  const remount = () => {
    setSession((current) => current + 1);
  };
  return (
    <ChatSession
      key={isClient ? `session-${String(session)}` : "server"}
      onNewChat={remount}
      onReconnect={remount}
      restore={isClient}
    />
  );
}
