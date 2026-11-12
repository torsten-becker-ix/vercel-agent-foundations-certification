import {
  AlertCircleIcon,
  CheckIcon,
  CircleSlashIcon,
  SearchXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ShoppingMessagePart } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

type ShoppingToolPart = Extract<
  ShoppingMessagePart,
  { type: `tool-${string}` }
>;

type Tone = "neutral" | "warning" | "error";

function StatusLine({
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

function Running({ children }: { children: string }) {
  return (
    <p className="text-xs">
      <Shimmer as="span" duration={1.5}>
        {children}
      </Shimmer>
    </p>
  );
}

function runningLabel(part: ShoppingToolPart): string {
  switch (part.type) {
    case "tool-getAllCategories":
      return "Checking categories…";
    case "tool-searchProducts": {
      const query = part.input?.query;
      return typeof query === "string" && query !== ""
        ? `Searching for “${query}”…`
        : "Searching products…";
    }
    case "tool-getProductDetails":
      return "Loading product details…";
  }
}

function failedLabel(part: ShoppingToolPart): string {
  switch (part.type) {
    case "tool-getAllCategories":
      return "Couldn't load categories.";
    case "tool-searchProducts":
      return "Product search failed.";
    case "tool-getProductDetails":
      return "Couldn't load product details.";
  }
}

function Outcome({ part }: { part: ShoppingToolPart }) {
  if (part.state !== "output-available") return null;
  switch (part.type) {
    case "tool-getAllCategories":
      return (
        <StatusLine icon={<CheckIcon />}>
          Checked {part.output.categories.length} categories
        </StatusLine>
      );
    case "tool-searchProducts": {
      const { output } = part;
      if (output.status === "unknown_category") {
        return (
          <StatusLine icon={<SearchXIcon />} tone="warning">
            No category “{output.category}”
          </StatusLine>
        );
      }
      if (output.products.length === 0) {
        return (
          <StatusLine icon={<SearchXIcon />} tone="warning">
            No matching products
          </StatusLine>
        );
      }
      return (
        <StatusLine icon={<CheckIcon />}>
          Found {output.total} {output.total === 1 ? "product" : "products"}
        </StatusLine>
      );
    }
    case "tool-getProductDetails": {
      const { output } = part;
      if (output.status === "not_found") {
        return (
          <StatusLine icon={<SearchXIcon />} tone="warning">
            Product not found
          </StatusLine>
        );
      }
      return (
        <StatusLine icon={<CheckIcon />}>{output.product.name}</StatusLine>
      );
    }
  }
}

/**
 * Progress and outcome of one tool call, in shopper language (no tool names
 * or raw data). Product results get richer cards in a later step.
 */
export function ToolStatus({
  part,
  isStreaming,
}: {
  part: ShoppingToolPart;
  /** False once the response ended (finished, stopped or failed). */
  isStreaming: boolean;
}) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return isStreaming ? (
        <Running>{runningLabel(part)}</Running>
      ) : (
        <StatusLine icon={<CircleSlashIcon />}>Stopped</StatusLine>
      );
    case "output-error":
    case "output-denied":
      return (
        <StatusLine icon={<AlertCircleIcon />} tone="error">
          {failedLabel(part)}
        </StatusLine>
      );
    case "output-available":
      return <Outcome part={part} />;
  }
}
