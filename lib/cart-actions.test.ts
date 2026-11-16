import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Api from "./api";
import { ApiRequestError, cartAdd, cartGet, cartRemove } from "./api";
import { addToCartAction, removeCartItemAction } from "./cart-actions";
import {
  clearCartToken,
  createCartToken,
  getCartToken,
  getOrCreateCartToken,
} from "./cart-token";
import type { CartWithProducts } from "./types";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof Api>();
  return {
    ApiRequestError: actual.ApiRequestError,
    cartAdd: vi.fn(),
    cartGet: vi.fn(),
    cartRemove: vi.fn(),
    cartUpdate: vi.fn(),
    getProductStock: vi.fn(),
  };
});
vi.mock("./cart-token", () => ({
  clearCartToken: vi.fn(),
  createCartToken: vi.fn(),
  getCartToken: vi.fn(),
  getOrCreateCartToken: vi.fn(),
}));

const notFound = (what: string) =>
  new ApiRequestError(404, "NOT_FOUND", `${what} not found`);
const cart = (token: string): CartWithProducts => ({
  token,
  items: [],
  totalItems: 1,
  subtotal: 3000,
  currency: "USD",
  createdAt: "",
  updatedAt: "",
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("addToCartAction", () => {
  it("starts a new cart when the stored one is gone", async () => {
    vi.mocked(getOrCreateCartToken).mockResolvedValue("stale");
    vi.mocked(createCartToken).mockResolvedValue("fresh");
    vi.mocked(cartGet).mockRejectedValue(notFound("Cart"));
    vi.mocked(cartAdd).mockImplementation(async (token) =>
      token === "stale"
        ? Promise.reject(notFound("Cart"))
        : Promise.resolve(cart(token)),
    );

    await expect(addToCartAction("tumbler_001")).resolves.toMatchObject({
      token: "fresh",
    });
    expect(cartAdd).toHaveBeenLastCalledWith("fresh", "tumbler_001", 1);
  });

  it("keeps the cart when the 404 is about something else", async () => {
    vi.mocked(getOrCreateCartToken).mockResolvedValue("live");
    vi.mocked(cartGet).mockResolvedValue(cart("live"));
    vi.mocked(cartAdd).mockRejectedValue(notFound("Product"));

    await expect(addToCartAction("nope")).rejects.toThrow("Product not found");
    expect(createCartToken).not.toHaveBeenCalled();
  });
});

describe("removeCartItemAction", () => {
  it("returns an empty cart and forgets the token when the cart is gone", async () => {
    vi.mocked(getCartToken).mockResolvedValue("stale");
    vi.mocked(cartRemove).mockRejectedValue(notFound("Cart"));
    vi.mocked(cartGet).mockRejectedValue(notFound("Cart"));

    await expect(removeCartItemAction("tumbler_001")).resolves.toMatchObject({
      items: [],
      totalItems: 0,
    });
    expect(clearCartToken).toHaveBeenCalled();
  });
});
