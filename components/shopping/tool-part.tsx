import {
  AlertCircleIcon,
  CheckIcon,
  CircleSlashIcon,
  ClockIcon,
  SearchXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { ProductDetailsCard } from "@/components/shopping/product-details-card";
import { ProductResults } from "@/components/shopping/product-results";
import {
  ReturnApprovalCard,
  ReturnDecisionCard,
  ReturnSubmittedCard,
} from "@/components/shopping/return-cards";
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
    case "tool-returnOrder":
      return part.state === "approval-responded"
        ? "Filing your return…"
        : "Checking your order…";
    case "tool-getReturnStatus":
      return "Checking your return…";
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
    case "tool-returnOrder":
      return "The return couldn't be filed.";
    case "tool-getReturnStatus":
      return "Couldn't check the return.";
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
    case "tool-returnOrder": {
      const { output } = part;
      switch (output.status) {
        case "submitted":
          return (
            <ReturnSubmittedCard
              items={output.items}
              orderId={output.orderId}
            />
          );
        case "not_found":
          return (
            <StatusLine icon={<SearchXIcon />} tone="warning">
              Order #{output.orderId} not found
            </StatusLine>
          );
        case "not_eligible":
          return (
            <StatusLine icon={<AlertCircleIcon />} tone="warning">
              Order #{output.orderId} can&apos;t be returned:{" "}
              {output.explanation}
            </StatusLine>
          );
      }
    }
    case "tool-getReturnStatus": {
      const { output } = part;
      switch (output.status) {
        case "done":
          return <ReturnDecisionCard outcome={output.outcome} />;
        case "processing":
          return (
            <StatusLine icon={<ClockIcon />}>
              The return is still being reviewed.
            </StatusLine>
          );
        case "failed":
          return (
            <StatusLine icon={<AlertCircleIcon />} tone="error">
              Processing the return failed. Please contact support with your
              order number.
            </StatusLine>
          );
        case "not_found":
          return (
            <StatusLine icon={<SearchXIcon />} tone="warning">
              No return found for that reference.
            </StatusLine>
          );
      }
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
  isLatest,
  shownBefore,
}: {
  part: ShoppingToolPart;
  /** Product ids already shown earlier in the same reply. */
  shownBefore: ReadonlySet<string>;
  /** False once the response ended (finished, stopped or failed). */
  isStreaming: boolean;
  /** Part of the conversation's last message. */
  isLatest: boolean;
}) {
  switch (part.state) {
    case "approval-requested":
      // Waiting for the shopper (the run has ended), so not "Stopped".
      if (part.type === "tool-returnOrder") {
        // Only the latest message can be answered: an approval in an older
        // message is never sent (sendAutomaticallyWhen looks at the last
        // message) and would leave a tool call without a result.
        if (!isLatest) {
          return (
            <StatusLine icon={<CircleSlashIcon />}>
              Return request for order #{part.input.orderId} expired. Ask again
              to return it.
            </StatusLine>
          );
        }
        return (
          <ReturnApprovalCard
            approvalId={part.approval.id}
            orderId={part.input.orderId}
            reason={part.input.reason}
          />
        );
      }
      return <Running>{runningLabel(part)}</Running>;
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return isStreaming ? (
        <Running>{runningLabel(part)}</Running>
      ) : (
        <StatusLine icon={<CircleSlashIcon />}>Stopped</StatusLine>
      );
    case "output-denied":
      return part.type === "tool-returnOrder" ? (
        <StatusLine icon={<CircleSlashIcon />}>
          Return not filed: you declined.
        </StatusLine>
      ) : (
        <StatusLine icon={<CircleSlashIcon />}>Cancelled</StatusLine>
      );
    case "output-error":
      return (
        <StatusLine icon={<AlertCircleIcon />} tone="error">
          {failedLabel(part)}
        </StatusLine>
      );
    case "output-available":
      return <Outcome part={part} shownBefore={shownBefore} />;
  }
}
