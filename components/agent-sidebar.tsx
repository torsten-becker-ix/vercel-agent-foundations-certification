"use client";

// First: configures zod before `ai` builds its schemas (see the module).
import "@/lib/zod-jitless";

import { useEffect, useRef } from "react";

import { AGENT_BUTTON_ID } from "@/components/agent-button";
import { AgentChat, CHAT_INPUT_ID } from "@/components/agent-chat";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const PANEL_TITLE = "Ship It Shop Agent";

/**
 * Moves focus with the panel: into the message input when it opens, back to
 * the robot button when it closes (if focus was inside the panel or lost).
 * Only on changes after mount, so a page loaded with `?chat=open` doesn't
 * steal focus.
 */
function usePanelFocus(isOpen: boolean) {
  const previous = useRef(isOpen);
  useEffect(() => {
    if (previous.current === isOpen) return;
    previous.current = isOpen;
    const frame = requestAnimationFrame(() => {
      if (isOpen) {
        document.getElementById(CHAT_INPUT_ID)?.focus();
        return;
      }
      const active = document.activeElement;
      const panel = document.querySelector('[data-slot="agent-panel"]');
      if (active === document.body || (panel?.contains(active) ?? false)) {
        document.getElementById(AGENT_BUTTON_ID)?.focus();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen]);
}

export function AgentSidebar() {
  const { open, openMobile, isMobile, setOpen } = useSidebar();
  usePanelFocus(isMobile ? openMobile : open);

  return (
    <Sidebar
      collapsible="offcanvas"
      // Desktop: Esc closes the panel (the mobile sheet already does).
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isMobile && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      side="right"
    >
      {/* Named region: a landmark screen-reader users can jump to. */}
      <section
        aria-label={PANEL_TITLE}
        className="flex h-full min-h-0 flex-col"
        data-slot="agent-panel"
      >
        <SidebarHeader>
          <h2 className="px-2 py-1.5 text-sm font-semibold">{PANEL_TITLE}</h2>
        </SidebarHeader>
        <SidebarContent className="overflow-hidden p-0">
          <AgentChat />
        </SidebarContent>
      </section>
    </Sidebar>
  );
}
