import { useChat } from "@ai-sdk/react";
import type { ChatOnFinishCallback, UIMessage } from "ai";
import { useEffect, useState } from "react";

import { type ChatStore, EMPTY_CHAT } from "@/lib/chat-storage";
import { createPersistentChat } from "@/lib/persistent-chat";

export interface PersistentChatSessionProps {
  /** Start from the stored chat (false for the server render). */
  restore: boolean;
  onNewChat: () => void;
  onReconnect: () => void;
}

/**
 * `useChat` over a durable workflow run, persisted in `localStorage`:
 * restores the chat after a refresh and resumes an answer still streaming
 * (only when a run id is stored: this transport throws on an empty resume).
 *
 * After a lost connection, `disconnected` turns true; the `online` event (or
 * the caller's Reconnect button) remounts the session from storage, exactly
 * like a refresh. Resuming in place would replay the run from its start on
 * top of the partial answer (duplicates).
 */
export function usePersistentChat<M extends UIMessage>({
  api,
  store,
  restore,
  onNewChat,
  onReconnect,
  onFinish,
  sendAutomaticallyWhen,
}: PersistentChatSessionProps & {
  api: string;
  store: ChatStore<M>;
  onFinish?: ChatOnFinishCallback<M> | undefined;
  sendAutomaticallyWhen?:
    | ((options: { messages: M[] }) => boolean | PromiseLike<boolean>)
    | undefined;
}) {
  /** The connection dropped while a run's answer was still streaming. */
  const [disconnected, setDisconnected] = useState(false);
  const [saved] = useState(() => (restore ? store.load() : EMPTY_CHAT));
  const [persistence] = useState(() =>
    createPersistentChat({ api, store, activeRunId: saved.activeRunId }),
  );

  const chat = useChat<M>({
    transport: persistence.transport,
    messages: saved.messages,
    resume: saved.activeRunId !== null,
    ...(sendAutomaticallyWhen === undefined ? {} : { sendAutomaticallyWhen }),
    onFinish: (event) => {
      // On an error the run may still be going: keep the stored run id, so a
      // refresh or a reconnect resumes it (or "Try again" starts a new one).
      if (!event.isError && !event.isDisconnect) {
        persistence.answerEnded(event.messages);
      }
      setDisconnected(event.isDisconnect && persistence.hasActiveRun());
      onFinish?.(event);
    },
  });

  useEffect(() => {
    if (!disconnected) return;
    window.addEventListener("online", onReconnect);
    return () => {
      window.removeEventListener("online", onReconnect);
    };
  }, [disconnected, onReconnect]);

  const { stop } = chat;
  const newChat = () => {
    persistence.discard();
    void stop();
    onNewChat();
  };

  return { ...chat, disconnected, newChat };
}
