"use server";

import { updateTag } from "next/cache";
import {
  ApiRequestError,
  cartAdd,
  cartGet,
  cartRemove,
  cartUpdate,
  getProductStock,
} from "./api";
import {
  clearCartToken,
  createCartToken,
  getCartToken,
  getOrCreateCartToken,
} from "./cart-token";
import type { CartWithProducts, StockInfo } from "./types";

const EMPTY_CART: CartWithProducts = {
  token: "",
  items: [],
  totalItems: 0,
  subtotal: 0,
  currency: "USD",
  createdAt: "",
  updatedAt: "",
};

/**
 * The store API forgets carts (the demo API's carts don't live as long as the
 * 30-day cookie) and then answers 404 for the stored token. A 404 can also
 * mean a missing product or item, so the cart itself is checked before it's
 * treated as gone (and replaced).
 */
async function isMissingCart(error: unknown, token: string): Promise<boolean> {
  if (!(error instanceof ApiRequestError) || error.status !== 404) return false;
  try {
    await cartGet(token);
    return false;
  } catch (getError) {
    return getError instanceof ApiRequestError && getError.status === 404;
  }
}

export async function getCartAction(): Promise<CartWithProducts> {
  const token = await getCartToken();
  if (token === undefined) return EMPTY_CART;
  try {
    return await cartGet(token);
  } catch {
    return EMPTY_CART;
  }
}

export async function addToCartAction(
  productId: string,
  quantity = 1,
): Promise<CartWithProducts> {
  const token = await getOrCreateCartToken();
  let cart: CartWithProducts;
  try {
    cart = await cartAdd(token, productId, quantity);
  } catch (error) {
    if (!(await isMissingCart(error, token))) throw error;
    // The stored cart is gone: start a new one and add the item there.
    cart = await cartAdd(await createCartToken(), productId, quantity);
  }
  updateTag("cart");
  return cart;
}

export async function updateCartItemAction(
  productId: string,
  quantity: number,
): Promise<CartWithProducts> {
  const token = await getCartToken();
  if (token === undefined) return EMPTY_CART;
  let cart: CartWithProducts;
  try {
    cart = await cartUpdate(token, productId, quantity);
  } catch (error) {
    if (!(await isMissingCart(error, token))) throw error;
    // The stored cart is gone, so there is nothing to update.
    await clearCartToken();
    return EMPTY_CART;
  }
  updateTag("cart");
  return cart;
}

export async function removeCartItemAction(
  productId: string,
): Promise<CartWithProducts> {
  const token = await getCartToken();
  if (token === undefined) return EMPTY_CART;
  let cart: CartWithProducts;
  try {
    cart = await cartRemove(token, productId);
  } catch (error) {
    if (!(await isMissingCart(error, token))) throw error;
    // The stored cart is gone, so there is nothing to remove.
    await clearCartToken();
    return EMPTY_CART;
  }
  updateTag("cart");
  return cart;
}

export async function getProductStockAction(
  idOrSlug: string,
): Promise<StockInfo> {
  return getProductStock(idOrSlug);
}
