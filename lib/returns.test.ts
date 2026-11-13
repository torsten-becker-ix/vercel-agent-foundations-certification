import { describe, expect, it } from "vitest";

import {
  orderIdSchema,
  returnCallbackSchema,
  returnEligibility,
  returnReasonSchema,
  toOrderSummary,
  toReturnOutcome,
} from "./returns";
import type { Order, Return } from "./types";

const order = (status: Order["status"]): Order => ({
  id: "11111",
  status,
  items: [
    {
      productId: "hoodie_001",
      quantity: 1,
      unitPrice: 6000,
      lineTotal: 6000,
      product: {
        id: "hoodie_001",
        name: "Black Pullover Hoodie",
        slug: "black-pullover-hoodie",
        description: "",
        price: 6000,
        currency: "USD",
        category: "hoodies",
        images: [],
        featured: false,
        tags: [],
        createdAt: "",
      },
    },
    { productId: "deskmat_001", quantity: 2, unitPrice: 2000, lineTotal: 4000 },
  ],
  subtotal: 10000,
  tax: 800,
  total: 10800,
  currency: "USD",
  email: "customer@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const ret = (overrides: Partial<Return> = {}): Return => ({
  id: "ret_1",
  orderId: "11111",
  callback: null,
  items: [],
  reason: "wrong size",
  status: "completed",
  scheduledFireAt: "",
  decision: "approved",
  refundAmount: 10800,
  notes: "Refund issued.",
  createdAt: "",
  updatedAt: "",
  processedAt: "",
  ...overrides,
});

describe("returnEligibility", () => {
  it("accepts fulfilled orders only", () => {
    expect(returnEligibility(order("fulfilled"))).toEqual({
      status: "eligible",
    });
    expect(returnEligibility(order("paid"))).toMatchObject({
      status: "not_eligible",
      orderStatus: "paid",
    });
    expect(returnEligibility(order("cancelled"))).toMatchObject({
      status: "not_eligible",
      orderStatus: "cancelled",
    });
  });
});

describe("toOrderSummary", () => {
  it("lists items with names and formatted totals, without the email", () => {
    const summary = toOrderSummary(order("fulfilled"));
    expect(summary).toEqual({
      orderId: "11111",
      status: "fulfilled",
      items: [
        {
          productId: "hoodie_001",
          name: "Black Pullover Hoodie",
          quantity: 1,
          lineTotalFormatted: "$60.00",
        },
        {
          productId: "deskmat_001",
          name: "deskmat_001",
          quantity: 2,
          lineTotalFormatted: "$40.00",
        },
      ],
      totalFormatted: "$108.00",
    });
    expect(JSON.stringify(summary)).not.toContain("customer@example.com");
  });
});

describe("toReturnOutcome", () => {
  it("formats an approved refund", () => {
    expect(toReturnOutcome(ret(), "USD")).toEqual({
      status: "decided",
      orderId: "11111",
      returnId: "ret_1",
      decision: "approved",
      refundFormatted: "$108.00",
      notes: "Refund issued.",
    });
  });

  it("has no refund for rejected or needs-info decisions", () => {
    expect(
      toReturnOutcome(ret({ decision: "rejected", refundAmount: 0 }), "USD"),
    ).toMatchObject({ decision: "rejected", refundFormatted: null });
    expect(
      toReturnOutcome(
        ret({ decision: "needs_info", refundAmount: null }),
        "USD",
      ),
    ).toMatchObject({ decision: "needs_info", refundFormatted: null });
  });

  it("is pending until the API has completed processing", () => {
    expect(
      toReturnOutcome(ret({ status: "processing", decision: null }), "USD"),
    ).toEqual({
      status: "pending",
      orderId: "11111",
      returnId: "ret_1",
      currency: "USD",
    });
  });
});

describe("input schemas", () => {
  it("accepts demo order ids and rejects odd input", () => {
    expect(orderIdSchema.safeParse(" 11111 ").success).toBe(true);
    expect(orderIdSchema.safeParse("11111; DROP").success).toBe(false);
    expect(orderIdSchema.safeParse("").success).toBe(false);
  });

  it("enforces the API's reason length", () => {
    expect(returnReasonSchema.safeParse("x").success).toBe(false);
    expect(returnReasonSchema.safeParse("wrong size").success).toBe(true);
    expect(returnReasonSchema.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("validates the webhook payload", () => {
    expect(
      returnCallbackSchema.safeParse({
        event: "return.processed",
        returnId: "ret_1",
      }).success,
    ).toBe(true);
    expect(returnCallbackSchema.safeParse({ event: "other" }).success).toBe(
      false,
    );
  });
});
