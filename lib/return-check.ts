/**
 * Order lookup + return eligibility, shared by the returnOrder tool (wrapped
 * in a workflow step) and the approval card's server action.
 */
import { getOrder } from "./api";
import {
  type OrderItemSummary,
  returnEligibility,
  type ReturnEligibility,
  toOrderSummary,
} from "./returns";
import { isApiStatus, rethrow } from "./tool-errors";

export type ReturnCheck =
  | {
      status: "eligible";
      orderId: string;
      items: OrderItemSummary[];
      totalFormatted: string;
    }
  | Exclude<ReturnEligibility, { status: "eligible" }>;

export async function lookupReturnCheck(orderId: string): Promise<ReturnCheck> {
  try {
    const order = await getOrder(orderId);
    const eligibility = returnEligibility(order);
    if (eligibility.status !== "eligible") return eligibility;
    const summary = toOrderSummary(order);
    return {
      status: "eligible",
      orderId: summary.orderId,
      items: summary.items,
      totalFormatted: summary.totalFormatted,
    };
  } catch (error) {
    if (isApiStatus(error, 404)) return { status: "not_found", orderId };
    rethrow(error, "Looking up the order");
  }
}
