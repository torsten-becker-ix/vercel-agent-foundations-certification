"use server";

import { lookupReturnCheck, type ReturnCheck } from "./return-check";
import { orderIdSchema } from "./returns";

/**
 * Order preview for the return approval card (items and total). Read-only,
 * without customer data; the same lookup the returnOrder tool does.
 */
export async function getReturnPreviewAction(
  orderId: string,
): Promise<ReturnCheck | { status: "invalid" }> {
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { status: "invalid" };
  return lookupReturnCheck(parsed.data);
}
