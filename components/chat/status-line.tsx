import type { ReactNode } from "react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

/** Compact tool status lines shared by the shopping and the admin chat. */

type Tone = "neutral" | "warning" | "error";

export function StatusLine({
  icon,
  tone = "neutral",
  children,
}: {
  icon: ReactNode;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        tone === "neutral" && "text-muted-foreground",
        tone === "warning" && "text-foreground",
        tone === "error" && "text-destructive",
      )}
    >
      <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
        {icon}
      </span>
      <span>{children}</span>
    </p>
  );
}

export function Running({ children }: { children: string }) {
  return (
    <p className="text-xs">
      <Shimmer as="span" duration={1.5}>
        {children}
      </Shimmer>
    </p>
  );
}
