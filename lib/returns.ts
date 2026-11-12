/**
 * Pure return logic shared by the return tools, the return workflow and the
 * approval card. No I/O here, so it is unit-tested directly.
 */
import { z } from "zod";

import { formatPrice } from "./format";
import type { Order, Return, ReturnDecision } from "./types";

/** Order ids accepted from the model (the API's demo ids are 5 digits). */
export const orderIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "Order ids contain only letters and digits.");

/** Same limits as the store API's `POST /returns` (3–500 characters). */
export const returnReasonSchema = z.string().trim().min(3).max(500);

export type ReturnEligibility =
  | { status: "eligible" }
  | { status: "not_found"; orderId: string }
  | {
      status: "not_eligible";
      orderId: string;
      orderStatus: Order["status"];
      explanation: string;
    };

/** The store API only accepts returns for fulfilled (delivered) orders. */
export function returnEligibility(order: Order): ReturnEligibility {
  switch (order.status) {
    case "fulfilled":
      return { status: "eligible" };
    case "paid":
      return {
        status: "not_eligible",
        orderId: order.id,
        orderStatus: order.status,
        explanation:
          "The order hasn't shipped yet, so it can't be returned. It can be returned once it has been delivered.",
      };
    case "cancelled":
      return {
        status: "not_eligible",
        orderId: order.id,
        orderStatus: order.status,
        explanation: "The order was cancelled, so there is nothing to return.",
      };
  }
}

export interface OrderItemSummary {
  productId: string;
  name: string;
  quantity: number;
  lineTotalFormatted: string;
}

/** What the shopper sees about an order. Never includes the customer email. */
export interface OrderSummary {
  orderId: string;
  status: Order["status"];
  items: OrderItemSummary[];
  totalFormatted: string;
}

export function toOrderSummary(order: Order): OrderSummary {
  return {
    orderId: order.id,
    status: order.status,
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.product?.name ?? item.productId,
      quantity: item.quantity,
      lineTotalFormatted: formatPrice(item.lineTotal, order.currency),
    })),
    totalFormatted: formatPrice(order.total, order.currency),
  };
}

/** Body the store API POSTs to the return's `callback` URL. */
export const returnCallbackSchema = z.object({
  event: z.literal("return.processed"),
  returnId: z.string(),
});

export interface ReturnDecided {
  status: "decided";
  orderId: string;
  returnId: string;
  decision: ReturnDecision;
  refundFormatted: string | null;
  notes: string | null;
}

export interface ReturnPending {
  status: "pending";
  orderId: string;
  returnId: string;
}

export type ReturnOutcome = ReturnDecided | ReturnPending;

/** Turns the API's return record into what the shopper is told. */
export function toReturnOutcome(ret: Return, currency: string): ReturnOutcome {
  if (ret.status !== "completed" || ret.decision === null) {
    return { status: "pending", orderId: ret.orderId, returnId: ret.id };
  }
  return {
    status: "decided",
    orderId: ret.orderId,
    returnId: ret.id,
    decision: ret.decision,
    refundFormatted:
      ret.decision === "approved" && ret.refundAmount !== null
        ? formatPrice(ret.refundAmount, currency)
        : null,
    notes: ret.notes,
  };
}
