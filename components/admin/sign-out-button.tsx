"use client";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/admin-actions";
import { ADMIN_CHAT_KEY, createChatStore } from "@/lib/chat-storage";

/**
 * Signs out and removes the stored admin conversation from this browser, so
 * the next person can't read revenue figures or ticket excerpts from it.
 */
export function SignOutButton() {
  return (
    <form
      action={logoutAction}
      onSubmit={() => {
        createChatStore(ADMIN_CHAT_KEY).clear();
      }}
    >
      <Button size="sm" type="submit" variant="ghost">
        Sign out
      </Button>
    </form>
  );
}
