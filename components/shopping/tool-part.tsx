import {
  AlertCircleIcon,
  CheckIcon,
  CircleSlashIcon,
  SearchXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { ProductDetailsCard } from "@/components/shopping/product-details-card";
import { ProductResults } from "@/components/shopping/product-results";
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

function Outcome({
  part,
  shownBefore,
}: {
  part: ShoppingToolPart;
  shownBefore: ReadonlySet<string>;
}) {
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
        <ProductResults
          category={output.category}
          match={output.match}
          page={output.page}
          pageSize={output.pageSize}
          products={output.products}
          query={output.query}
          shownBefore={shownBefore}
          total={output.total}
        />
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
        <ProductDetailsCard product={output.product} stock={output.stock} />
      );
    }
  }
}

/**
 * One tool call in the conversation, in shopper language (no tool names or
 * raw data): progress while it runs, product cards for results, and a short
 * explanation for failures, empty results or missing products.
 */
export function ToolPart({
  part,
  isStreaming,
  shownBefore,
}: {
  part: ShoppingToolPart;
  /** Product ids already shown earlier in the same reply. */
  shownBefore: ReadonlySet<string>;
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
      return <Outcome part={part} shownBefore={shownBefore} />;
  }
}
