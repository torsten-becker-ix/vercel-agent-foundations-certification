import "server-only";

import type {
  ApiError,
  BackOfficeDateRangeMeta,
  BackOfficeReturnDecision,
  BackOfficeReturnStatus,
  BackOfficeSalesMeta,
  BackOfficeStockMeta,
  CartWithProducts,
  CategorySlug,
  Category,
  PaginationMeta,
  Product,
  ProductSalesRow,
  Promotion,
  StockEntry,
  StockInfo,
  StoreConfig,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  Order,
  RefundPreauthorization,
  Return,
} from "./types";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  "https://vercel-agentic-swag-store-api.vercel.app/api";
const PROTECTION_BYPASS = process.env.BYPASS_SECRET ?? "";

const DEFAULT_REVALIDATE = 300; // 5 minutes for read endpoints

interface RequestOptions {
  method?: string;
  body?: unknown;
  cartToken?: string;
  cache?: RequestCache;
  next?: { revalidate?: number; tags?: string[] };
}

interface ApiSuccess<T, M = { pagination?: PaginationMeta }> {
  success: true;
  data: T;
  meta?: M;
}

interface ApiFailure {
  success: false;
  error: ApiError;
}

interface CreateReturnInput {
  orderId: string;
  items: { productId: string; quantity: number }[];
  reason: string;
  callback?: string; // used in phase 3
}

type ApiResult<T, M = { pagination?: PaginationMeta }> =
  | ApiSuccess<T, M>
  | ApiFailure;

// Append the Vercel deployment-protection bypass as a query param.
// Some protection configurations only honor the bypass via query (the header
// variant requires a cookie round-trip that server-side `fetch` won't follow).
function withBypass(path: string): string {
  const url = `${API_BASE_URL}${path}`;
  if (!PROTECTION_BYPASS) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(PROTECTION_BYPASS)}`;
}

export class ApiRequestError extends Error {
  status: number;
  code: string | undefined;
  details: unknown;
  constructor(
    status: number,
    code: string | undefined,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, cartToken, cache, next } = options;

  const headers: Record<string, string> = {
    "x-vercel-protection-bypass": PROTECTION_BYPASS,
  };
  if (cartToken !== undefined && cartToken !== "") headers["x-cart-token"] = cartToken;
  if (body !== undefined) headers["content-type"] = "application/json";

  const init: RequestInit & { next?: RequestOptions["next"] } = {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  };
  if (cache) init.cache = cache;
  if (next) init.next = next;

  let res: Response;
  try {
    res = await fetch(withBypass(path), init);
  } catch (err) {
    console.error(`[api] ${method} ${path} network error:`, err);
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      `Network request failed: ${method} ${path}`,
      err,
    );
  }

  let json: ApiResult<T> | undefined;
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    // ignore — handled below
  }

  if (!res.ok || !json?.success) {
    const apiErr = json && !json.success ? json.error : undefined;
    const error = new ApiRequestError(
      res.status,
      apiErr?.code,
      apiErr?.message ?? `API request failed: ${String(res.status)} ${path}`,
      apiErr?.details,
    );
    // Expected 404s (e.g. no active promotion) are swallowed by callers; don't
    // pollute logs with them. Log every other failure once, here.
    if (res.status !== 404) {
      console.error(`[api] ${method} ${path} failed:`, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }

  return json.data;
}

// Variant of `request` that returns both `data` and `meta`. Used by
// back-office endpoints whose `meta` carries information you actually want
// (date windows, aggregate totals, pagination) rather than just bookkeeping.
// The API response shape is trusted (typed from the store's OpenAPI spec), so the
// caller picks `T`/`M`. Runtime validation happens at the agent tool boundary.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- return-type-only generics by design (see comment above)
async function requestWithMeta<T, M>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: M }> {
  const { method = "GET", body, cartToken, cache, next } = options;

  const headers: Record<string, string> = {
    "x-vercel-protection-bypass": PROTECTION_BYPASS,
  };
  if (cartToken !== undefined && cartToken !== "") headers["x-cart-token"] = cartToken;
  if (body !== undefined) headers["content-type"] = "application/json";

  const init: RequestInit & { next?: RequestOptions["next"] } = {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  };
  if (cache) init.cache = cache;
  if (next) init.next = next;

  let res: Response;
  try {
    res = await fetch(withBypass(path), init);
  } catch (err) {
    console.error(`[api] ${method} ${path} network error:`, err);
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      `Network request failed: ${method} ${path}`,
      err,
    );
  }

  let json: ApiResult<T, M> | undefined;
  try {
    json = (await res.json()) as ApiResult<T, M>;
  } catch {
    // ignore — handled below
  }

  if (!res.ok || !json?.success) {
    const apiErr = json && !json.success ? json.error : undefined;
    const error = new ApiRequestError(
      res.status,
      apiErr?.code,
      apiErr?.message ?? `API request failed: ${String(res.status)} ${path}`,
      apiErr?.details,
    );
    if (res.status !== 404) {
      console.error(`[api] ${method} ${path} failed:`, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }

  if (json.meta === undefined) {
    const error = new ApiRequestError(
      res.status,
      undefined,
      `API response missing meta: ${path}`,
    );
    console.error(`[api] ${method} ${path} failed:`, {
      status: error.status,
      message: error.message,
    });
    throw error;
  }

  return { data: json.data, meta: json.meta };
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

// Builds `path?query` from a params object whose keys are the API's query names.
// `undefined`, empty strings and empty arrays are omitted; arrays are comma-joined.
function withQuery<P extends { readonly [K in keyof P]: QueryValue }>(
  path: string,
  params: P,
): string {
  const qs = new URLSearchParams();
  // Object.entries loses P's value type through the generic; the constraint guarantees it.
  for (const [key, value] of Object.entries<QueryValue>(params)) {
    if (value === undefined || value === "") continue;
    if (typeof value === "object") {
      if (value.length > 0) qs.set(key, value.join(","));
      continue;
    }
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return query === "" ? path : `${path}?${query}`;
}

export interface GetProductsParams {
  page?: number | undefined;
  limit?: number | undefined;
  category?: CategorySlug | (string & {}) | undefined;
  search?: string | undefined;
  featured?: boolean | undefined;
}

export async function getProducts(
  params: GetProductsParams = {},
): Promise<Product[]> {
  const path = withQuery("/products", params);
  return request<Product[]>(path, {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["products"] },
  });
}

export async function getProductById(idOrSlug: string): Promise<Product> {
  return request<Product>(`/products/${encodeURIComponent(idOrSlug)}`, {
    next: {
      revalidate: DEFAULT_REVALIDATE,
      tags: ["products", `product:${idOrSlug}`],
    },
  });
}

export async function getCategories(): Promise<Category[]> {
  return request<Category[]>("/categories", {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["categories"] },
  });
}

export async function getPromotion(): Promise<Promotion | null> {
  try {
    return await request<Promotion>("/promotions", {
      next: { revalidate: 60, tags: ["promotion"] },
    });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

export async function getStoreConfig(): Promise<StoreConfig> {
  return request<StoreConfig>("/store/config", {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["store-config"] },
  });
}

export async function getProductStock(idOrSlug: string): Promise<StockInfo> {
  return request<StockInfo>(`/products/${encodeURIComponent(idOrSlug)}/stock`, {
    cache: "no-store",
  });
}

export async function cartCreate(): Promise<{
  token: string;
  cart: CartWithProducts;
}> {
  const res = await fetch(withBypass("/cart/create"), {
    method: "POST",
    headers: {
      "x-vercel-protection-bypass": PROTECTION_BYPASS,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      undefined,
      `cartCreate failed: ${String(res.status)}`,
    );
  }
  const token = res.headers.get("x-cart-token") ?? "";
  const json = (await res.json()) as ApiResult<CartWithProducts>;
  if (!json.success) {
    throw new ApiRequestError(
      res.status,
      json.error.code,
      json.error.message,
      json.error.details,
    );
  }
  return { token: token || json.data.token, cart: json.data };
}

export async function cartGet(token: string): Promise<CartWithProducts> {
  return request<CartWithProducts>("/cart", {
    cartToken: token,
    cache: "no-store",
  });
}

export async function cartAdd(
  token: string,
  productId: string,
  quantity = 1,
): Promise<CartWithProducts> {
  return request<CartWithProducts>("/cart", {
    method: "POST",
    cartToken: token,
    body: { productId, quantity },
    cache: "no-store",
  });
}

export async function cartUpdate(
  token: string,
  productId: string,
  quantity: number,
): Promise<CartWithProducts> {
  return request<CartWithProducts>(`/cart/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    cartToken: token,
    body: { quantity },
    cache: "no-store",
  });
}

export async function cartRemove(
  token: string,
  productId: string,
): Promise<CartWithProducts> {
  return request<CartWithProducts>(`/cart/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    cartToken: token,
    cache: "no-store",
  });
}

export async function getOrder(id: string): Promise<Order> {
  return request<Order>(`/orders/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
}

export async function createReturn(input: CreateReturnInput): Promise<Return> {
  return request<Return>("/returns", {
    method: "POST",
    body: input,
    cache: "no-store",
  });
}

// eslint-disable-next-line @typescript-eslint/require-await -- stand-in for an async email-provider call
export async function notifyReturnInProcess(orderId: string): Promise<void> {
  // In production this would hit your email provider.
  // eslint-disable-next-line no-console -- intentional stand-in for the customer email
  console.log(
    `[returnOrder] 📧 told customer their return for order ${orderId} is being processed`,
  );
}

export async function preauthorizeRefund(
  orderId: string,
): Promise<RefundPreauthorization> {
  return request<RefundPreauthorization>("/refunds/preauthorize", {
    method: "POST",
    body: { orderId },
    cache: "no-store",
  });
}

// ---------------------------------------------------------------------------
// Back Office (admin)
//
// All back-office reads use `cache: "no-store"` — they power the admin agent,
// not the public storefront, so freshness matters more than throughput. None
// of these are linked from publicly cached pages.
// ---------------------------------------------------------------------------

export interface GetBackOfficeReturnsParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string | undefined;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string | undefined;
  status?: BackOfficeReturnStatus | undefined;
  decision?: BackOfficeReturnDecision | undefined;
  /** 1–500, default 25. */
  limit?: number | undefined;
}

export async function getBackOfficeReturns(
  params: GetBackOfficeReturnsParams = {},
): Promise<{ data: Return[]; meta: BackOfficeDateRangeMeta }> {
  const path = withQuery("/back-office/returns", params);
  return requestWithMeta<Return[], BackOfficeDateRangeMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeSupportTicketsParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string | undefined;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string | undefined;
  status?: SupportTicketStatus | undefined;
  priority?: SupportTicketPriority | undefined;
  category?: SupportTicketCategory | undefined;
  /** Staff username (e.g. `alex`). Unassigned tickets are excluded when set. */
  assignee?: string | undefined;
  /** 1–500, default 25. */
  limit?: number | undefined;
}

export async function getBackOfficeSupportTickets(
  params: GetBackOfficeSupportTicketsParams = {},
): Promise<{ data: SupportTicket[]; meta: BackOfficeDateRangeMeta }> {
  const path = withQuery("/back-office/support-tickets", params);
  return requestWithMeta<SupportTicket[], BackOfficeDateRangeMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeStockParams {
  /** Restrict to specific product IDs. Joined as a comma-separated list. */
  productIds?: string[] | undefined;
  /** When set, filters to (or excludes) products with 1–5 units in stock. */
  lowStock?: boolean | undefined;
  /** When set, filters to (or excludes) products with at least one unit. */
  inStock?: boolean | undefined;
  /** 1-based page number, default 1. */
  page?: number | undefined;
  /** 1–200, default 50. */
  limit?: number | undefined;
}

export async function getBackOfficeStock(
  params: GetBackOfficeStockParams = {},
): Promise<{ data: StockEntry[]; meta: BackOfficeStockMeta }> {
  const path = withQuery("/back-office/inventory/stock", params);
  return requestWithMeta<StockEntry[], BackOfficeStockMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeSalesParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string | undefined;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string | undefined;
  /** Restrict to a single product. 404 if it doesn't exist. */
  productId?: string | undefined;
}

export async function getBackOfficeSales(
  params: GetBackOfficeSalesParams = {},
): Promise<{ data: ProductSalesRow[]; meta: BackOfficeSalesMeta }> {
  const path = withQuery("/back-office/analytics/sales", params);
  return requestWithMeta<ProductSalesRow[], BackOfficeSalesMeta>(path, {
    cache: "no-store",
  });
}
