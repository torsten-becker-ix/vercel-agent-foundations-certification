import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, getOrder } from "./api";
import { lookupReturnCheck } from "./return-check";
import type { Order } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof Api>();
  return { ApiRequestError: actual.ApiRequestError, getOrder: vi.fn() };
});

import type * as Api from "./api";

const order = (status: Order["status"]): Order => ({
  id: "11111",
  status,
  items: [
    { productId: "mug_001", quantity: 1, unitPrice: 1800, lineTotal: 1800 },
  ],
  subtotal: 1800,
  tax: 144,
  total: 1944,
  currency: "USD",
  email: "customer@example.com",
  createdAt: "",
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("lookupReturnCheck", () => {
  it("returns the order summary for fulfilled orders, without the email", async () => {
    vi.mocked(getOrder).mockResolvedValue(order("fulfilled"));
    const result = await lookupReturnCheck("11111");
    expect(result).toMatchObject({
      status: "eligible",
      totalFormatted: "$19.44",
    });
    expect(JSON.stringify(result)).not.toContain("customer@example.com");
  });

  it("explains why paid and cancelled orders can't be returned", async () => {
    vi.mocked(getOrder).mockResolvedValue(order("paid"));
    await expect(lookupReturnCheck("11111")).resolves.toMatchObject({
      status: "not_eligible",
      orderStatus: "paid",
    });
  });

  it("maps 404 to not_found", async () => {
    vi.mocked(getOrder).mockRejectedValue(
      new ApiRequestError(404, "NOT_FOUND", "x"),
    );
    await expect(lookupReturnCheck("99999")).resolves.toEqual({
      status: "not_found",
      orderId: "99999",
    });
  });

  it("re-throws transient failures so the step retries", async () => {
    vi.mocked(getOrder).mockRejectedValue(new ApiRequestError(503, "X", "x"));
    await expect(lookupReturnCheck("11111")).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });
});
