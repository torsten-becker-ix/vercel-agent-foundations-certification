import type { ProductSummary } from "@/lib/tools";

export interface ProductResultsProps {
  products: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  query: string | null;
  category: string | null;
  match: "phrase" | "keywords";
  /** Products already shown earlier in the same reply (not repeated). */
  shownBefore: ReadonlySet<string>;
}

/** Row heading, e.g. "Showing 13–24 of 28 products". */
export function resultsHeading(
  { total, page, pageSize, match }: ProductResultsProps,
  shownCount: number,
  repeated: number,
): string {
  if (match === "keywords") return "Closest matches";
  const first = (page - 1) * pageSize + 1;
  const last = first + shownCount + repeated - 1;
  if (repeated > 0) return `${String(shownCount)} more of ${String(total)}`;
  if (first > 1 || last < total) {
    return `Showing ${String(first)}–${String(last)} of ${String(total)} products`;
  }
  return total === 1 ? "1 product" : `${String(total)} products`;
}

/** Link to the storefront search with the same filters, when it shows more. */
export function seeAllHref({
  products,
  total,
  query,
  category,
  match,
}: ProductResultsProps): string | null {
  if (match !== "phrase" || total <= products.length) return null;
  const params = new URLSearchParams();
  if (query !== null) params.set("q", query);
  if (category !== null) params.set("category", category);
  return `/search?${params.toString()}`;
}
