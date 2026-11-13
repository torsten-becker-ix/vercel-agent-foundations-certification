"use client";

import { Fragment, type ReactNode, useState } from "react";

import { useIsClient } from "@/hooks/use-is-client";
import type { PersistentChatSessionProps } from "@/hooks/use-persistent-chat";

/**
 * Mounts one chat session and remounts it (via `key`) for "New chat" and for
 * a reconnect. The server render starts empty; after hydration the session
 * remounts with the stored chat, so there's no hydration mismatch.
 */
export function PersistentChatRoot({
  children,
}: {
  children: (props: PersistentChatSessionProps) => ReactNode;
}) {
  const isClient = useIsClient();
  const [session, setSession] = useState(0);
  const remount = () => {
    setSession((current) => current + 1);
  };
  return (
    <Fragment key={isClient ? `session-${String(session)}` : "server"}>
      {children({
        restore: isClient,
        onNewChat: remount,
        onReconnect: remount,
      })}
    </Fragment>
  );
}
