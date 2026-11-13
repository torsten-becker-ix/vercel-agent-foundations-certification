import type { ShoppingUIMessage } from "@/lib/chat-types";
import { isWorkflowRunId } from "@/lib/workflow-run-id";

/**
 * Persists the shopping chat in `localStorage`, so a page refresh restores
 * the conversation and reconnects to an answer that is still streaming.
 *
 * `messages` never contains the answer that is in flight: it is saved when a
 * request is sent (the messages that went to the server) and when an answer
 * ends. After a refresh the in-flight answer is rebuilt once from the durable
 * stream of `activeRunId`, so it can't appear twice.
 */
export interface StoredChat {
  readonly messages: ShoppingUIMessage[];
  /** The run streaming the latest answer; `null` once that answer ended. */
  readonly activeRunId: string | null;
}

export const EMPTY_CHAT: StoredChat = { messages: [], activeRunId: null };

const STORAGE_KEY = "ship-it-shop:chat";
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
function isMessage(value: unknown): value is ShoppingUIMessage {
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
export function parseStoredChat(raw: string | null): StoredChat {
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
    messages,
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

export function loadChat(): StoredChat {
  try {
    return parseStoredChat(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return EMPTY_CHAT;
  }
}

export function saveChat(chat: StoredChat): void {
  try {
    if (chat.messages.length === 0) storage()?.removeItem(STORAGE_KEY);
    else storage()?.setItem(STORAGE_KEY, serializeChat(chat));
  } catch {
    // Persistence is best effort; the chat keeps working without it.
  }
}

export function clearChat(): void {
  saveChat(EMPTY_CHAT);
}
