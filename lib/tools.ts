/**
 * Shopping agent tools. Each `execute` is a workflow step (`"use step"`):
 * it runs with full Node.js access, is retried on failure, and its result is
 * persisted so completed tool calls are never re-run on replay.
 */
import { tool } from "ai";
import { z } from "zod";

import { getCategories } from "./api";

export async function getAllCategoriesStep() {
  "use step";
  const categories = await getCategories();
  return {
    categories: categories.map(({ slug, name, productCount }) => ({
      slug,
      name,
      productCount,
    })),
  };
}

export const shoppingTools = {
  getAllCategories: tool({
    description:
      "List the store's current product categories (slug, name, product count). Use it to discover valid category filters instead of guessing.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),
};
