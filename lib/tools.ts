/**
 * Shopping agent tools.
 *
 * Each `execute` is a workflow step (`"use step"`): it runs with full Node.js
 * access, is retried on failure (default 3 attempts), and its result is
 * persisted, so completed tool calls are never re-run on replay.
 *
 * Error contract:
 * - Expected outcomes (not found, unknown category, no results) are returned
 *   as typed results with a `status`, so the model can explain them and the
 *   UI can render them. They are never thrown.
 * - Transient failures (network, 5xx, 429) are re-thrown: the step retries,
 *   and if it still fails the agent receives a tool error it can explain.
 * - Any other API rejection means our request was wrong; it is a `FatalError`
 *   (no pointless retries).
 *
 * Outputs are small and serializable and never contain secrets or customer
 * data. Prices are integer cents plus a pre-formatted `priceFormatted`.
 */
import { tool } from "ai";
import { getRun, start } from "workflow/api";
import { z } from "zod";

import {
  getCategories,
  getProductById,
  getProductStock,
  getProductsPage,
} from "./api";
import { formatPrice } from "./format";
import { lookupReturnCheck, type ReturnCheck } from "./return-check";
import {
  type OrderItemSummary,
  orderIdSchema,
  returnReasonSchema,
  type ReturnOutcome,
} from "./returns";
import { isApiStatus, rethrow } from "./tool-errors";
import type { Product } from "./types";

export type { ReturnCheck } from "./return-check";
export { isTransientApiError } from "./tool-errors";
import { returnFlow } from "./workflows/return-flow";

export const SEARCH_DEFAULT_LIMIT = 12;
export const SEARCH_MAX_LIMIT = 24;
const SEARCH_MAX_PAGE = 50;

// ---------------------------------------------------------------------------
// Result types (discriminated by `status`; the chat UI switches on them)
// ---------------------------------------------------------------------------

export interface CategorySummary {
  slug: string;
  name: string;
  productCount: number;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  /** Integer cents (for the UI). */
  price: number;
  currency: string;
  /**
   * Display price, e.g. "$60.00". gpt-oss workaround (precaution): it handled
   * cents correctly in tests but miscounted lists, so it gets no arithmetic.
   */
  priceFormatted: string;
  category: string;
  image: string | null;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  images: string[];
  tags: string[];
}

export interface StockSummary {
  stock: number;
  inStock: boolean;
  lowStock: boolean;
}

export interface GetAllCategoriesResult {
  status: "ok";
  /** Number of categories. gpt-oss workaround: it miscounted the list (14, 15 instead of 13). */
  total: number;
  categories: CategorySummary[];
}

export type SearchProductsResult =
  | {
      status: "ok";
      query: string | null;
      category: string | null;
      /**
       * `phrase`: the API matched the whole query. `keywords`: the phrase had
       * no match, so products matching the most individual words are shown.
       */
      match: "phrase" | "keywords";
      products: ProductSummary[];
      page: number;
      /** Products per page (the last page may hold fewer). */
      pageSize: number;
      totalPages: number;
      total: number;
      hasNextPage: boolean;
    }
  | {
      status: "unknown_category";
      category: string;
      validCategories: string[];
    };

export type GetProductDetailsResult =
  | { status: "ok"; product: ProductDetail; stock: StockSummary }
  | { status: "not_found"; idOrSlug: string };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

// gpt-oss workaround: gpt-oss sends `null` for omitted optional fields, so the
// optional inputs accept `null` and are normalized to `undefined`.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) =>
      value === null || value === undefined || value === "" ? undefined : value,
    );

const optionalInt = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? undefined);

export const searchProductsInputSchema = z.object({
  query: optionalText(100).describe(
    "Search text matched against product names, descriptions and tags. Prefer one or two keywords (e.g. 'hoodie'). Omit to browse.",
  ),
  category: optionalText(50).describe(
    "Category slug from getAllCategories (e.g. 'hoodies'). Omit for all categories.",
  ),
  page: optionalInt(1, SEARCH_MAX_PAGE).describe("1-based page number."),
  limit: optionalInt(1, SEARCH_MAX_LIMIT).describe(
    `Products per page (default ${String(SEARCH_DEFAULT_LIMIT)}).`,
  ),
});

export const getProductDetailsInputSchema = z.object({
  idOrSlug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe(
      "Product id or slug exactly as returned by searchProducts (e.g. 'black-pullover-hoodie').",
    ),
});

export type SearchProductsInput = z.output<typeof searchProductsInputSchema>;
export type GetProductDetailsInput = z.output<
  typeof getProductDetailsInputSchema
>;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toProductSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    currency: product.currency,
    priceFormatted: formatPrice(product.price, product.currency),
    category: product.category,
    image: product.images[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export async function getAllCategoriesStep(): Promise<GetAllCategoriesResult> {
  "use step";
  try {
    const categories = await getCategories();
    return {
      status: "ok",
      total: categories.length,
      categories: categories.map(({ slug, name, productCount }) => ({
        slug,
        name,
        productCount,
      })),
    };
  } catch (error) {
    rethrow(error, "Loading categories");
  }
}

/** Words worth searching for on their own (the API matches one phrase). */
export function searchKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length >= 2);
  return [...new Set(words)];
}

/**
 * Fallback for multi-word queries without a phrase match ("black hoodie" vs.
 * "Black Pullover Hoodie"): search each keyword and rank products by how many
 * keywords they match. Returns null when there is nothing to fall back to.
 */
async function searchByKeywords(
  query: string,
  category: string | undefined,
  limit: number,
): Promise<SearchProductsResult | null> {
  const keywords = searchKeywords(query);
  if (keywords.length < 2) return null;

  const pages = await Promise.all(
    keywords.map(async (keyword) =>
      getProductsPage({ search: keyword, category, limit: SEARCH_MAX_LIMIT }),
    ),
  );
  const hits = new Map<string, { product: Product; score: number }>();
  for (const { products } of pages) {
    for (const product of products) {
      const hit = hits.get(product.id);
      if (hit === undefined) hits.set(product.id, { product, score: 1 });
      else hit.score += 1;
    }
  }
  const best = Math.max(0, ...[...hits.values()].map(({ score }) => score));
  const ranked = [...hits.values()]
    .filter(({ score }) => score === best)
    .slice(0, limit)
    .map(({ product }) => toProductSummary(product));

  return {
    status: "ok",
    query,
    category: category ?? null,
    match: "keywords",
    products: ranked,
    page: 1,
    pageSize: limit,
    totalPages: ranked.length === 0 ? 0 : 1,
    total: ranked.length,
    hasNextPage: false,
  };
}

export async function searchProductsStep(
  input: SearchProductsInput,
): Promise<SearchProductsResult> {
  "use step";
  const { query, category, page, limit = SEARCH_DEFAULT_LIMIT } = input;
  try {
    const { products, pagination } = await getProductsPage({
      search: query,
      category,
      page,
      limit,
    });
    if (products.length === 0 && query !== undefined && (page ?? 1) === 1) {
      const keywordResult = await searchByKeywords(query, category, limit);
      if (keywordResult !== null) return keywordResult;
    }
    return {
      status: "ok",
      query: query ?? null,
      category: category ?? null,
      match: "phrase",
      products: products.map(toProductSummary),
      page: pagination.page,
      pageSize: pagination.limit,
      totalPages: pagination.totalPages,
      total: pagination.total,
      hasNextPage: pagination.hasNextPage,
    };
  } catch (error) {
    // The API answers an unknown category slug with 422 VALIDATION_ERROR.
    if (category !== undefined && isApiStatus(error, 422)) {
      const categories = await getCategories();
      return {
        status: "unknown_category",
        category,
        validCategories: categories.map(({ slug }) => slug),
      };
    }
    rethrow(error, "Searching products");
  }
}

export async function getProductDetailsStep(
  input: GetProductDetailsInput,
): Promise<GetProductDetailsResult> {
  "use step";
  const { idOrSlug } = input;
  try {
    const [product, stock] = await Promise.all([
      getProductById(idOrSlug),
      getProductStock(idOrSlug),
    ]);
    return {
      status: "ok",
      product: {
        ...toProductSummary(product),
        description: product.description,
        images: product.images,
        tags: product.tags,
      },
      stock: {
        stock: stock.stock,
        inStock: stock.inStock,
        lowStock: stock.lowStock,
      },
    };
  } catch (error) {
    if (isApiStatus(error, 404)) return { status: "not_found", idOrSlug };
    rethrow(error, "Loading product details");
  }
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const returnOrderInputSchema = z.object({
  orderId: orderIdSchema.describe("The shopper's order number, e.g. '11111'."),
  reason: returnReasonSchema.describe(
    "Why the shopper returns the order, in their words (3–500 characters).",
  ),
});

export const getReturnStatusInputSchema = z.object({
  returnRunId: z
    .string()
    .trim()
    .regex(/^wrun_[0-9A-Z]{26}$/)
    .describe("The returnRunId from the returnOrder result."),
});

export type ReturnOrderInput = z.output<typeof returnOrderInputSchema>;
export type GetReturnStatusInput = z.output<typeof getReturnStatusInputSchema>;

export type ReturnOrderResult =
  | {
      status: "filed";
      orderId: string;
      /** Id of the return workflow run, for getReturnStatus. */
      returnRunId: string;
      items: OrderItemSummary[];
    }
  | Exclude<ReturnCheck, { status: "eligible" }>;

export type GetReturnStatusResult =
  | { status: "processing"; returnRunId: string }
  | { status: "done"; returnRunId: string; outcome: ReturnOutcome }
  | { status: "failed"; returnRunId: string }
  | { status: "not_found"; returnRunId: string };

/** Workflow step wrapper around `lookupReturnCheck` (retried, persisted). */
export async function checkReturnStep(orderId: string): Promise<ReturnCheck> {
  "use step";
  return lookupReturnCheck(orderId);
}

/**
 * Runs in the workflow (no "use step"): `start()` here is step-backed and
 * deterministic, so a replayed chat run never starts the return twice. The
 * return runs as its own workflow and doesn't block the chat; the shopper is
 * told right away that it was filed.
 */
export async function returnOrderExecute(
  input: ReturnOrderInput,
): Promise<ReturnOrderResult> {
  const check = await checkReturnStep(input.orderId);
  if (check.status !== "eligible") return check;
  const run = await start(returnFlow, [
    { orderId: check.orderId, reason: input.reason },
  ]);
  return {
    status: "filed",
    orderId: check.orderId,
    returnRunId: run.runId,
    items: check.items,
  };
}

export async function getReturnStatusStep(
  input: GetReturnStatusInput,
): Promise<GetReturnStatusResult> {
  "use step";
  const { returnRunId } = input;
  const run = getRun<ReturnOutcome>(returnRunId);
  if (!(await run.exists)) return { status: "not_found", returnRunId };
  switch (await run.status) {
    case "completed":
      return { status: "done", returnRunId, outcome: await run.returnValue };
    case "failed":
    case "cancelled":
      return { status: "failed", returnRunId };
    case "pending":
    case "running":
      return { status: "processing", returnRunId };
  }
}

// ---------------------------------------------------------------------------
// Tool set
// ---------------------------------------------------------------------------

export const shoppingTools = {
  getAllCategories: tool({
    description:
      "List the store's current product categories (slug, name, product count). Use it to discover valid category filters instead of guessing.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),
  searchProducts: tool({
    description:
      'Search or browse the product catalog by text and/or category. Returns product summaries with prices and pagination. If the exact phrase has no match, it falls back to the best keyword matches (`match: "keywords"`). An empty `products` list means nothing matched; `unknown_category` lists the valid slugs.',
    inputSchema: searchProductsInputSchema,
    execute: searchProductsStep,
  }),
  getProductDetails: tool({
    description:
      "Get full details for one product: description, price, all images, tags and live stock. Use the id or slug from searchProducts. `not_found` means the product doesn't exist.",
    inputSchema: getProductDetailsInputSchema,
    execute: getProductDetailsStep,
  }),
  returnOrder: tool({
    description:
      "Return all items of a delivered order. Needs the order number and the shopper's reason. The shopper confirms with a button before anything happens. Results: `filed` (return started; the decision follows in about a minute), `not_eligible` (with explanation) or `not_found`.",
    inputSchema: returnOrderInputSchema,
    // Only eligible orders get an approval card; anything else is answered
    // directly by execute (not_found / not_eligible), with nothing to approve.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- WorkflowAgent configures approval per tool via needsApproval (node_modules/ai/docs/03-agents/07-workflow-agent.mdx); call-level toolApproval is for ToolLoopAgent/streamText
    needsApproval: async ({ orderId }) =>
      (await checkReturnStep(orderId)).status === "eligible",
    execute: returnOrderExecute,
  }),
  getReturnStatus: tool({
    description:
      "Check a filed return: `processing`, `done` with the decision (approved with refund, rejected, or needs more info), or `failed`.",
    inputSchema: getReturnStatusInputSchema,
    execute: getReturnStatusStep,
  }),
};
