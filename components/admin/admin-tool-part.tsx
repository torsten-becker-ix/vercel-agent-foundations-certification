import {
  AlertCircleIcon,
  BookmarkIcon,
  CheckIcon,
  CircleSlashIcon,
} from "lucide-react";

import { Running, StatusLine } from "@/components/chat/status-line";
import type { AdminMessagePart } from "@/lib/admin/chat-types";

import { BashOutput } from "./bash-output";

export type AdminToolPart = Extract<
  AdminMessagePart,
  { type: `tool-${string}` }
>;

function runningLabel(part: AdminToolPart): string {
  switch (part.type) {
    case "tool-getAllCategories":
      return "Checking categories…";
    case "tool-searchProducts":
      return "Searching products…";
    case "tool-getSupportTickets":
      return "Loading support tickets…";
    case "tool-getReturnsHistory":
      return "Loading returns…";
    case "tool-getInventoryStock":
      return "Checking inventory…";
    case "tool-getSalesAnalytics":
      return "Loading sales…";
    case "tool-bash":
      return "Running a command…";
    case "tool-saveMemory":
      return "Saving to memory…";
  }
}

function failedLabel(part: AdminToolPart): string {
  switch (part.type) {
    case "tool-getAllCategories":
      return "Couldn't load categories.";
    case "tool-searchProducts":
      return "Product search failed.";
    case "tool-getSupportTickets":
      return "Couldn't load support tickets.";
    case "tool-getReturnsHistory":
      return "Couldn't load returns.";
    case "tool-getInventoryStock":
      return "Couldn't load inventory.";
    case "tool-getSalesAnalytics":
      return "Couldn't load sales.";
    case "tool-bash":
      return "The command couldn't run.";
    case "tool-saveMemory":
      return "Couldn't save to memory.";
  }
}

const day = (iso: string) => iso.slice(0, 10);

/** Short, shopper-free summary of a finished tool call. */
function Done({
  part,
}: {
  part: AdminToolPart & { state: "output-available" };
}) {
  switch (part.type) {
    case "tool-getAllCategories":
      return (
        <StatusLine icon={<CheckIcon />}>
          Checked {part.output.total} categories
        </StatusLine>
      );
    case "tool-searchProducts":
      return (
        <StatusLine icon={<CheckIcon />}>
          {part.output.status === "ok"
            ? `Found ${String(part.output.total)} products`
            : `Unknown category “${part.output.category}”`}
        </StatusLine>
      );
    case "tool-getSupportTickets":
      return (
        <StatusLine icon={<CheckIcon />}>
          Loaded {part.output.count} support tickets ({day(part.output.from)} –{" "}
          {day(part.output.to)})
        </StatusLine>
      );
    case "tool-getReturnsHistory":
      return (
        <StatusLine icon={<CheckIcon />}>
          Loaded {part.output.count} returns ({day(part.output.from)} –{" "}
          {day(part.output.to)})
        </StatusLine>
      );
    case "tool-getInventoryStock":
      return (
        <StatusLine icon={<CheckIcon />}>
          Checked stock for {part.output.items.length} of{" "}
          {part.output.pagination.total} products
        </StatusLine>
      );
    case "tool-getSalesAnalytics":
      return (
        <StatusLine icon={<CheckIcon />}>
          Loaded sales for {part.output.productCount} products (
          {day(part.output.from)} – {day(part.output.to)})
        </StatusLine>
      );
    case "tool-bash":
      return (
        <BashOutput
          command={part.input.command}
          result={part.output}
          state="done"
        />
      );
    case "tool-saveMemory":
      return (
        <StatusLine icon={<BookmarkIcon />}>
          {part.output.saved
            ? `Saved to memory: “${part.output.note}”`
            : `Already in memory: “${part.output.note}”`}
        </StatusLine>
      );
  }
}

/** One admin tool call: progress, a short result, or the failure. */
export function AdminToolPart({
  part,
  isStreaming,
}: {
  part: AdminToolPart;
  /** False once the response ended (finished, stopped or failed). */
  isStreaming: boolean;
}) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      if (part.type === "tool-bash") {
        return (
          <BashOutput
            command={part.input?.command}
            state={isStreaming ? "running" : "stopped"}
          />
        );
      }
      return isStreaming ? (
        <Running>{runningLabel(part)}</Running>
      ) : (
        <StatusLine icon={<CircleSlashIcon />}>Stopped</StatusLine>
      );
    case "output-available":
      return <Done part={part} />;
    case "output-error":
      if (part.type === "tool-bash") {
        return (
          <BashOutput
            command={part.input?.command}
            errorText={
              part.errorText.includes("InvalidToolInput")
                ? "the agent sent a malformed command and retries"
                : undefined
            }
            state="error"
          />
        );
      }
      return (
        <StatusLine icon={<AlertCircleIcon />} tone="error">
          {failedLabel(part)}
        </StatusLine>
      );
    case "output-denied":
      return null;
  }
}
