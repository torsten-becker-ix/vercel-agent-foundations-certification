"use client";

import { createContext, type ReactNode, use } from "react";

/** Chat actions that tool cards trigger (approval buttons, follow-ups). */
export interface ChatActions {
  respondToApproval: (approvalId: string, approved: boolean) => void;
  send: (text: string) => void;
  isBusy: boolean;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

export function ChatActionsProvider({
  value,
  children,
}: {
  value: ChatActions;
  children: ReactNode;
}) {
  return <ChatActionsContext value={value}>{children}</ChatActionsContext>;
}

export function useChatActions(): ChatActions {
  const actions = use(ChatActionsContext);
  if (actions === null) {
    throw new Error("useChatActions must be used inside ChatActionsProvider");
  }
  return actions;
}
