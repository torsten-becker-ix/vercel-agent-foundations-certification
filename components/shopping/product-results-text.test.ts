import { describe, expect, it } from "vitest";

import type { ProductSummary } from "@/lib/tools";

import {
  type ProductResultsProps,
  resultsHeading,
  seeAllHref,
} from "./product-results-text";

const product = (id: string): ProductSummary => ({
  id,
  slug: id,
  name: id,
  price: 100,
  currency: "USD",
  priceFormatted: "$1.00",
  category: "mugs",
  image: null,
});

const props = (
  overrides: Partial<ProductResultsProps> = {},
): ProductResultsProps => ({
  products: [product("a"), product("b")],
  total: 2,
  page: 1,
  pageSize: 12,
  query: "mug",
  category: null,
  match: "phrase",
  shownBefore: new Set(),
  ...overrides,
});

describe("resultsHeading", () => {
  it("counts all products when everything fits", () => {
    expect(resultsHeading(props(), 2, 0)).toBe("2 products");
    expect(resultsHeading(props({ total: 1 }), 1, 0)).toBe("1 product");
  });

  it("shows the range of the first page", () => {
    expect(resultsHeading(props({ total: 28 }), 12, 0)).toBe(
      "Showing 1–12 of 28 products",
    );
  });

  it("shows the range of a later page", () => {
    expect(resultsHeading(props({ total: 28, page: 2 }), 12, 0)).toBe(
      "Showing 13–24 of 28 products",
    );
  });

  it("says how many are new when some were shown before", () => {
    expect(resultsHeading(props({ total: 28 }), 3, 9)).toBe("3 more of 28");
  });

  it("labels keyword fallbacks as closest matches", () => {
    expect(resultsHeading(props({ match: "keywords" }), 2, 0)).toBe(
      "Closest matches",
    );
  });
});

describe("seeAllHref", () => {
  it("links to the storefront search when there are more results", () => {
    expect(seeAllHref(props({ total: 28, category: "mugs" }))).toBe(
      "/search?q=mug&category=mugs",
    );
  });

  it("is omitted when all results are shown or for keyword matches", () => {
    expect(seeAllHref(props())).toBeNull();
    expect(seeAllHref(props({ total: 28, match: "keywords" }))).toBeNull();
  });
});
