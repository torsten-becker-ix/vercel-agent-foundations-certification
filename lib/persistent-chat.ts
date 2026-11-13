import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { ChatTransport, UIMessage } from "ai";

import type { ChatStore } from "@/lib/chat-storage";

/**
 * `WorkflowChatTransport` POSTs a JSON string without a `Content-Type`, so the
 * browser sends `text/plain`, which the chat routes reject (415, CSRF guard).
 */
export const chatFetch: typeof fetch = async (input, init) => {
  if (init?.method !== "POST") return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(input, { ...init, headers });
};

/**
 * A chat transport plus the `localStorage` bookkeeping around it (see
 * `lib/chat-storage`). Plain closure state, not React state: it changes in
 * transport callbacks and is never rendered.
 *
 * `api` is the chat route; its resume route is `${api}/<runId>/stream`.
 */
export function createPersistentChat<M extends UIMessage>({
  api,
  store,
  activeRunId,
}: {
  api: string;
  store: ChatStore<M>;
  activeRunId: string | null;
}) {
  /** The run of the latest answer; resume after a refresh reconnects to it. */
  let runId = activeRunId;
  /** Set by "New chat", so a late callback doesn't save the old chat again. */
  let discarded = false;

  // Type-only cast: under `exactOptionalPropertyTypes`, @ai-sdk/workflow's
  // `messageId?: string` doesn't accept the `string | undefined` that `ai`
  // passes. Runtime contract is identical (see CLAUDE.md exceptions).
  const transport = new WorkflowChatTransport<M>({
    api,
    fetch: chatFetch,
    maxConsecutiveErrors: 5,
    // The run has started: save what was sent plus its run id, before any of
    // the answer arrives. A refresh from here on resumes this run.
    onChatSendMessage: (response, { messages }) => {
      if (discarded) return;
      runId = response.headers.get("x-workflow-run-id");
      store.save({ messages, activeRunId: runId });
    },
    // Resume after a refresh only knows the chat id; point it at the run.
    // (Reconnects within a request already use this same run id.)
    prepareReconnectToStreamRequest: ({ api: defaultApi }) => ({
      api:
        runId === null
          ? defaultApi
          : `${api}/${encodeURIComponent(runId)}/stream`,
    }),
  }) as unknown as ChatTransport<M>;

  return {
    transport,
    /** A run's answer is stored as unfinished and can be resumed. */
    hasActiveRun: () => runId !== null && !discarded,
    /** The run of the answer in flight, if any. */
    activeRunId: () => runId,
    /** The answer is complete (or stopped): nothing left to resume. */
    answerEnded: (messages: M[]) => {
      if (discarded) return;
      runId = null;
      store.save({ messages, activeRunId: null });
    },
    discard: () => {
      discarded = true;
      store.clear();
    },
  };
}
