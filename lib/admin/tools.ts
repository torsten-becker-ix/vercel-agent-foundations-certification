import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  getBackOfficeReturns,
  getProducts,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getStoreConfig,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { rethrow } from "@/lib/tool-errors";
import { optionalInt, optionalText, shoppingTools } from "@/lib/tools";

import { MEMORY_NOTE_MAX, normalizeNote, saveNote } from "./memory";
import {
  type BashResult,
  dataFileName,
  runBash,
  writeDataFile,
} from "./sandbox";

/**
 * Admin agent tools. Back-office tools fetch on the server (the API secret
 * never leaves it), strip personal data, write the full rows into the admin
 * sandbox for `bash`, and return a compact summary plus the file path.
 * Everything here is read-only towards the store.
 */

// ---------------------------------------------------------------------------
// Inputs (gpt-oss workaround: `null` for omitted optionals, see lib/tools.ts)
// ---------------------------------------------------------------------------

const optionalDate = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/,
    "YYYY-MM-DD or ISO 8601",
  )
  .nullish()
  .transform((value) => value ?? undefined);

const optionalEnum = <const T extends readonly [string, ...string[]]>(
  values: T,
) =>
  z
    .enum(values)
    .nullish()
    .transform((value) => value ?? undefined);

const optionalBool = z
  .boolean()
  .nullish()
  .transform((value) => value ?? undefined);

const dateRange = {
  from: optionalDate.describe(
    "Start (YYYY-MM-DD or ISO 8601). Default: 30 days before `to`.",
  ),
  to: optionalDate.describe("End (YYYY-MM-DD or ISO 8601). Default: now."),
};

export const supportTicketsInputSchema = z.object({
  ...dateRange,
  status: optionalEnum(["open", "pending", "resolved", "closed"]),
  priority: optionalEnum(["low", "normal", "high", "urgent"]),
  category: optionalEnum([
    "shipping",
    "returns",
    "product_quality",
    "sizing",
    "billing",
    "payment",
    "account",
    "other",
  ]),
  assignee: optionalText(40).describe("Staff username, e.g. `alex`."),
  limit: optionalInt(1, 500).describe("Max tickets (1–500, default 25)."),
});

export const returnsHistoryInputSchema = z.object({
  ...dateRange,
  status: optionalEnum(["pending", "processing", "completed"]),
  decision: optionalEnum(["approved", "rejected", "needs_info"]),
  limit: optionalInt(1, 500).describe("Max returns (1–500, default 25)."),
});

export const inventoryStockInputSchema = z.object({
  productIds: z
    .array(z.string().trim().min(1).max(60))
    .max(50)
    .nullish()
    .transform((value) => value ?? undefined)
    .describe("Only these product ids (from searchProducts)."),
  lowStock: optionalBool.describe("Only low-stock products."),
  inStock: optionalBool.describe("true: only in stock; false: only sold out."),
  page: optionalInt(1, 1000),
  // gpt-oss workaround: it asked for limit 500 here (the API allows 100), and
  // the provider rejected the whole tool call. Accept it and clamp instead.
  limit: optionalInt(1, 500)
    .transform((value) =>
      value === undefined ? undefined : Math.min(value, 100),
    )
    .describe("Page size (1–100; larger values are capped at 100)."),
});

export const salesAnalyticsInputSchema = z.object({
  ...dateRange,
  productId: optionalText(60).describe(
    "Only this product id (from searchProducts).",
  ),
});

export const bashInputSchema = z.object({
  // gpt-oss writes 2–3k-character python heredocs for one analysis (measured
  // 2,100–3,100). A 2,000 cap made the provider reject the whole call.
  command: z
    .string()
    .trim()
    .min(1)
    .max(8_000)
    .describe(
      "Bash command run in the admin sandbox home directory (python3, jq, coreutils; no network). Data files from the back-office tools are under data/.",
    ),
});

export const saveMemoryInputSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3)
    .max(MEMORY_NOTE_MAX)
    .describe("One short sentence to remember, in the employee's words."),
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 10;

/**
 * How the model finds the full data in the sandbox: the file is always a JSON
 * array of rows, shown by one example row. (gpt-oss workaround: with only
 * the summary's shape to go on, it assumed `{ items: [...] }` for the stock
 * file and spent 12 failing bash calls on it.)
 */
function describeFile(path: string | null, rows: readonly unknown[]) {
  return {
    file: path,
    fileFormat: "JSON array of rows" as const,
    fileRowCount: rows.length,
    fileRowExample: rows[0] ?? null,
  };
}
const PREVIEW_CHARS = 160;

/** Product id → name from the (cached) catalog; empty if it can't load. */
async function productNames(): Promise<Map<string, string>> {
  try {
    const products = await getProducts({ limit: 100 });
    return new Map(products.map(({ id, name }) => [id, name]));
  } catch {
    return new Map();
  }
}

async function storeCurrency(): Promise<string> {
  try {
    return (await getStoreConfig()).currency;
  } catch {
    return "USD";
  }
}

export async function getSupportTicketsStep(
  input: z.output<typeof supportTicketsInputSchema>,
) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(input);
    // No customer emails (PII) in the model context or the sandbox.
    const rows = data.map(({ customerEmail: _email, ...ticket }) => ticket);
    const file = await writeDataFile(
      dataFileName("support-tickets", input),
      rows,
    );
    return {
      count: meta.count,
      from: meta.from,
      to: meta.to,
      ...describeFile(file, rows),
      sample: rows.slice(0, SAMPLE_SIZE).map((ticket) => ({
        ...ticket,
        messagePreview: ticket.messagePreview.slice(0, PREVIEW_CHARS),
      })),
    };
  } catch (error) {
    rethrow(error, "Loading support tickets");
  }
}

export async function getReturnsHistoryStep(
  input: z.output<typeof returnsHistoryInputSchema>,
) {
  "use step";
  try {
    const [{ data, meta }, currency, names] = await Promise.all([
      getBackOfficeReturns(input),
      storeCurrency(),
      productNames(),
    ]);
    // `callback` is a webhook URL (a bearer token): never passed on. Item
    // names come from the catalog, so a ranking needs no product lookups.
    const rows = data.map(({ callback: _callback, ...ret }) => ({
      ...ret,
      items: ret.items.map((item) => ({
        ...item,
        name: names.get(item.productId) ?? null,
      })),
    }));
    const file = await writeDataFile(dataFileName("returns", input), rows);
    return {
      count: meta.count,
      from: meta.from,
      to: meta.to,
      currency,
      moneyUnit: "cents" as const,
      ...describeFile(file, rows),
      sample: rows.slice(0, SAMPLE_SIZE).map((ret) => ({
        id: ret.id,
        orderId: ret.orderId,
        items: ret.items,
        reason: ret.reason,
        status: ret.status,
        decision: ret.decision,
        refundFormatted:
          ret.refundAmount === null
            ? null
            : formatPrice(ret.refundAmount, currency),
        orderTotalFormatted:
          ret.order === null || ret.order === undefined
            ? null
            : formatPrice(ret.order.total, currency),
        createdAt: ret.createdAt,
      })),
    };
  } catch (error) {
    rethrow(error, "Loading returns");
  }
}

export async function getInventoryStockStep(
  input: z.output<typeof inventoryStockInputSchema>,
) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock(input);
    const file = await writeDataFile(dataFileName("stock", input), data);
    return {
      pagination: meta.pagination,
      ...describeFile(file, data),
      items: data.map((entry) => ({
        productId: entry.productId,
        name: entry.product.name,
        category: entry.product.category,
        stock: entry.stock,
        inStock: entry.inStock,
        lowStock: entry.lowStock,
      })),
    };
  } catch (error) {
    rethrow(error, "Loading inventory");
  }
}

export async function getSalesAnalyticsStep(
  input: z.output<typeof salesAnalyticsInputSchema>,
) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(input);
    const file = await writeDataFile(dataFileName("sales", input), data);
    return {
      from: meta.from,
      to: meta.to,
      days: meta.days,
      currency: meta.currency,
      moneyUnit: "cents" as const,
      totals: {
        unitsSold: meta.totals.unitsSold,
        ordersCount: meta.totals.ordersCount,
        revenueFormatted: formatPrice(meta.totals.revenue, meta.currency),
      },
      productCount: meta.count,
      ...describeFile(file, data),
      topByRevenue: data
        .toSorted((a, b) => b.revenue - a.revenue)
        .slice(0, SAMPLE_SIZE)
        .map((row) => ({
          productId: row.productId,
          name: row.product.name,
          unitsSold: row.unitsSold,
          ordersCount: row.ordersCount,
          revenueFormatted: formatPrice(row.revenue, row.currency),
        })),
    };
  } catch (error) {
    rethrow(error, "Loading sales");
  }
}

export async function bashStep({
  command,
}: z.output<typeof bashInputSchema>): Promise<BashResult> {
  "use step";
  return runBash(command);
}

export async function saveMemoryStep({
  note,
}: z.output<typeof saveMemoryInputSchema>) {
  "use step";
  const text = normalizeNote(note);
  return { note: text, ...(await saveNote(text)) };
}

// ---------------------------------------------------------------------------
// Tool set
// ---------------------------------------------------------------------------

export const adminTools = {
  getAllCategories: shoppingTools.getAllCategories,
  searchProducts: shoppingTools.searchProducts,
  getSupportTickets: tool({
    description:
      "Support tickets in a date range (default: last 30 days), filterable by status, priority, category and assignee. Returns the count, the range, a sample and `file` (all rows as JSON in the sandbox, for bash). Customer emails are never included.",
    inputSchema: supportTicketsInputSchema,
    execute: getSupportTicketsStep,
  }),
  getReturnsHistory: tool({
    description:
      "Historical returns in a date range (default: last 30 days), filterable by status and decision. Includes order id, items, reason, decision and refund. Money in the file is in cents. Returns count, range, a sample and `file` for bash.",
    inputSchema: returnsHistoryInputSchema,
    execute: getReturnsHistoryStep,
  }),
  getInventoryStock: tool({
    description:
      "Current stock per product, filterable by product ids, low stock and availability; paginated (`pagination`). Returns the page's items and `file` for bash.",
    inputSchema: inventoryStockInputSchema,
    execute: getInventoryStockStep,
  }),
  getSalesAnalytics: tool({
    description:
      "Sales per product in a date range (default: last 30 days), optionally for one product: units sold, orders, revenue, plus totals. Money in the file is in cents. Returns totals, the top products by revenue and `file` for bash.",
    inputSchema: salesAnalyticsInputSchema,
    execute: getSalesAnalyticsStep,
  }),
  bash: tool({
    description:
      "Run a bash command in the admin sandbox (python3, jq; no network; 30 s limit). Use it to compute aggregates and joins over the JSON files the back-office tools wrote (e.g. return rates = returned units / units sold per product). Returns exitCode, stdout, stderr.",
    inputSchema: bashInputSchema,
    execute: bashStep,
  }),
  saveMemory: tool({
    description:
      "Save one note for future conversations: an employee preference, a correction or business context they stated. Never store store data (it changes), personal data or secrets.",
    inputSchema: saveMemoryInputSchema,
    execute: saveMemoryStep,
  }),
};
