import type { UIMessage } from "ai";

import { isWorkflowRunId } from "@/lib/workflow-run-id";

/**
 * Persists a chat in `localStorage`, so a page refresh restores the
 * conversation and reconnects to an answer that is still streaming. Used by
 * the shopping chat and the admin chat, each under its own key.
 *
 * `messages` never contains the answer that is in flight: it is saved when a
 * request is sent (the messages that went to the server) and when an answer
 * ends. After a refresh the in-flight answer is rebuilt once from the durable
 * stream of `activeRunId`, so it can't appear twice.
 */
export interface StoredChat<M extends UIMessage = UIMessage> {
  readonly messages: M[];
  /** The run streaming the latest answer; `null` once that answer ended. */
  readonly activeRunId: string | null;
}

export const EMPTY_CHAT: StoredChat<never> = {
  messages: [],
  activeRunId: null,
};

export const SHOPPING_CHAT_KEY = "ship-it-shop:chat";
export const ADMIN_CHAT_KEY = "ship-it-shop:admin-chat";
/** Bump when the stored shape changes; older entries are then ignored. */
const VERSION = 1;

interface Envelope {
  version: typeof VERSION;
  messages: unknown;
  activeRunId: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shallow shape check. The data comes from this app on the same origin, so
 * this guards against old formats and hand-edited storage, not attackers.
 * The server validates the messages again on the next request.
 */
function isMessage(value: unknown): value is UIMessage {
  if (!isRecord(value)) return false;
  const { id, role, parts } = value;
  return (
    typeof id === "string" &&
    (role === "user" || role === "assistant") &&
    Array.isArray(parts) &&
    parts.every((part) => isRecord(part) && typeof part["type"] === "string")
  );
}

/** Parses a stored value; anything unexpected yields an empty chat. */
export function parseStoredChat<M extends UIMessage = UIMessage>(
  raw: string | null,
): StoredChat<M> {
  if (raw === null) return EMPTY_CHAT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_CHAT;
  }
  if (!isRecord(value) || value["version"] !== VERSION) return EMPTY_CHAT;
  const { messages, activeRunId } = value;
  if (!Array.isArray(messages) || !messages.every(isMessage)) {
    return EMPTY_CHAT;
  }
  return {
    // Shape-checked above; the message type is the caller's (its own key).
    messages: messages as M[],
    activeRunId:
      typeof activeRunId === "string" && isWorkflowRunId(activeRunId)
        ? activeRunId
        : null,
  };
}

export function serializeChat(chat: StoredChat): string {
  const envelope: Envelope = { version: VERSION, ...chat };
  return JSON.stringify(envelope);
}

/** `localStorage` can throw (blocked storage, private mode, quota). */
function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export interface ChatStore<M extends UIMessage> {
  load: () => StoredChat<M>;
  save: (chat: StoredChat<M>) => void;
  clear: () => void;
}

/** One chat's storage under `key` (best effort: storage can be unavailable). */
export function createChatStore<M extends UIMessage>(
  key: string,
): ChatStore<M> {
  const save = (chat: StoredChat<M>) => {
    try {
      if (chat.messages.length === 0) storage()?.removeItem(key);
      else storage()?.setItem(key, serializeChat(chat));
    } catch {
      // Persistence is best effort; the chat keeps working without it.
    }
  };
  return {
    load: () => {
      try {
        return parseStoredChat<M>(storage()?.getItem(key) ?? null);
      } catch {
        return EMPTY_CHAT;
      }
    },
    save,
    clear: () => {
      save(EMPTY_CHAT);
    },
  };
}
