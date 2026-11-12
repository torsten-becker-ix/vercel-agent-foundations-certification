"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  PackageIcon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { getReturnPreviewAction } from "@/lib/order-actions";
import type { ReturnCheck } from "@/lib/return-check";
import type { OrderItemSummary, ReturnOutcome } from "@/lib/returns";

import { useChatActions } from "./chat-actions";

function CardShell({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm"
    >
      <h3
        className="flex items-center gap-2 font-medium text-foreground"
        id={headingId}
      >
        <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ItemList({ items }: { items: OrderItemSummary[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li className="flex justify-between gap-3" key={item.productId}>
          <span>
            {item.quantity} × {item.name}
          </span>
          <span className="shrink-0">{item.lineTotalFormatted}</span>
        </li>
      ))}
    </ul>
  );
}

type Preview = ReturnCheck | { status: "invalid" } | { status: "error" };

/** Shown while the agent waits for the shopper to approve the return. */
export function ReturnApprovalCard({
  approvalId,
  orderId,
  reason,
}: {
  approvalId: string;
  orderId: string;
  reason: string;
}) {
  const { respondToApproval, isBusy } = useChatActions();
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReturnPreviewAction(orderId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <CardShell icon={<PackageIcon />} title={`Return order #${orderId}?`}>
      <p className="text-xs text-muted-foreground">Reason: “{reason}”</p>
      {preview === null ? (
        <p className="text-xs text-muted-foreground">Loading the order…</p>
      ) : preview.status === "eligible" ? (
        <>
          <ItemList items={preview.items} />
          <p className="text-xs text-muted-foreground">
            All items in this order are returned (order total{" "}
            {preview.totalFormatted}). Nothing happens until you approve.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          The order details couldn&apos;t be loaded. Nothing happens until you
          approve.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Approve return for order ${orderId}`}
          disabled={isBusy}
          onClick={() => {
            respondToApproval(approvalId, true);
          }}
          size="sm"
          type="button"
        >
          Approve return
        </Button>
        <Button
          aria-label={`Deny return for order ${orderId}`}
          disabled={isBusy}
          onClick={() => {
            respondToApproval(approvalId, false);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Deny
        </Button>
      </div>
    </CardShell>
  );
}

/** Confirmation shown as soon as the return workflow has started. */
export function ReturnFiledCard({
  orderId,
  items,
}: {
  orderId: string;
  items: OrderItemSummary[];
}) {
  const { send, isBusy } = useChatActions();
  return (
    <CardShell
      icon={<CheckCircle2Icon />}
      title={`Return filed for order #${orderId}`}
    >
      <ItemList items={items} />
      <p className="text-xs text-muted-foreground">
        The store reviews returns within about a minute. You can keep shopping
        meanwhile.
      </p>
      <Button
        className="self-start"
        disabled={isBusy}
        onClick={() => {
          send(`What's the status of my return for order ${orderId}?`);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Check status
      </Button>
    </CardShell>
  );
}

/** The store's decision on a filed return. */
export function ReturnDecisionCard({ outcome }: { outcome: ReturnOutcome }) {
  if (outcome.status === "pending") {
    return (
      <CardShell
        icon={<ClockIcon />}
        title={`Return for order #${outcome.orderId} is still being reviewed`}
      >
        <p className="text-xs text-muted-foreground">
          The store hasn&apos;t decided yet. Please check again in a moment.
        </p>
      </CardShell>
    );
  }
  const notes =
    outcome.notes !== null && outcome.notes !== "" ? (
      <p className="text-xs text-muted-foreground">{outcome.notes}</p>
    ) : null;
  switch (outcome.decision) {
    case "approved":
      return (
        <CardShell
          icon={<CheckCircle2Icon />}
          title={`Return approved for order #${outcome.orderId}`}
        >
          {outcome.refundFormatted !== null ? (
            <p className="text-xs text-foreground">
              Refund: {outcome.refundFormatted} to the original payment method.
            </p>
          ) : null}
          {notes}
        </CardShell>
      );
    case "rejected":
      return (
        <CardShell
          icon={<XCircleIcon />}
          title={`Return rejected for order #${outcome.orderId}`}
        >
          {notes}
        </CardShell>
      );
    case "needs_info":
      return (
        <CardShell
          icon={<AlertCircleIcon />}
          title={`The store needs more information about order #${outcome.orderId}`}
        >
          {notes}
        </CardShell>
      );
  }
}
