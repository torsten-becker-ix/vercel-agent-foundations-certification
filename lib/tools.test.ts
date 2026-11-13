import { afterEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";

import type * as Api from "./api";
import {
  ApiRequestError,
  getCategories,
  getProductById,
  getProductStock,
  getProductsPage,
} from "./api";
import {
  getAllCategoriesStep,
  getProductDetailsInputSchema,
  getProductDetailsStep,
  isTransientApiError,
  SEARCH_DEFAULT_LIMIT,
  searchKeywords,
  searchProductsInputSchema,
  searchProductsStep,
  slugAsPhrase,
} from "./tools";
import type { Category, PaginationMeta, Product } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof Api>();
  return {
    ApiRequestError: actual.ApiRequestError,
    getCategories: vi.fn(),
    getProductById: vi.fn(),
    getProductStock: vi.fn(),
    getProductsPage: vi.fn(),
  };
});

const product: Product = {
  id: "hoodie_001",
  name: "Black Pullover Hoodie",
  slug: "black-pullover-hoodie",
  description: "Soft and warm.",
  price: 6500,
  currency: "USD",
  category: "hoodies",
  images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
  featured: true,
  tags: ["apparel"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const categories: Category[] = [
  { slug: "hoodies", name: "Hoodies", productCount: 1 },
  { slug: "mugs", name: "Mugs", productCount: 2 },
];

function pagination(overrides: Partial<PaginationMeta> = {}): PaginationMeta {
  return {
    page: 1,
    limit: SEARCH_DEFAULT_LIMIT,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    ...overrides,
  };
}

const apiError = (status: number) =>
  new ApiRequestError(status, "X", `failed ${String(status)}`);

afterEach(() => {
  vi.resetAllMocks();
});

describe("isTransientApiError", () => {
  it.each([0, 429, 500, 503])("treats status %i as transient", (status) => {
    expect(isTransientApiError(apiError(status))).toBe(true);
  });

  it.each([400, 404, 422])("treats status %i as permanent", (status) => {
    expect(isTransientApiError(apiError(status))).toBe(false);
  });

  it("retries unknown (non-API) errors", () => {
    expect(isTransientApiError(new TypeError("boom"))).toBe(true);
  });
});

describe("getAllCategoriesStep", () => {
  it("returns slug, name and count only", async () => {
    vi.mocked(getCategories).mockResolvedValue(categories);
    await expect(getAllCategoriesStep()).resolves.toEqual({
      status: "ok",
      total: 2,
      categories,
    });
  });

  it("doesn't blame the category for other validation errors", async () => {
    vi.mocked(getProductsPage).mockRejectedValue(
      new ApiRequestError(422, "VALIDATION_ERROR", "Invalid query parameters", {
        limit: ["Number must be less than or equal to 100"],
      }),
    );
    await expect(
      searchProductsStep({
        query: undefined,
        category: "hoodies",
        page: undefined,
        limit: undefined,
      }),
    ).rejects.toThrow("rejected by the store API (status 422)");
    expect(getCategories).not.toHaveBeenCalled();
  });

  it("searches at most four keywords in the fallback", async () => {
    vi.mocked(getProductsPage).mockResolvedValue({
      products: [],
      pagination: {
        page: 1,
        limit: 24,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    await searchProductsStep({
      query: "aa bb cc dd ee ff gg hh ii jj kk ll",
      category: undefined,
      page: undefined,
      limit: undefined,
    });
    // One phrase search + at most four keyword searches.
    expect(getProductsPage).toHaveBeenCalledTimes(5);
  });

  it("re-throws transient failures so the step retries", async () => {
    vi.mocked(getCategories).mockRejectedValue(apiError(503));
    await expect(getAllCategoriesStep()).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });
});

describe("searchProductsInputSchema", () => {
  it("normalizes null and empty values from the model to undefined", () => {
    expect(
      searchProductsInputSchema.parse({
        query: "  ",
        category: null,
        page: null,
      }),
    ).toEqual({
      query: undefined,
      category: undefined,
      page: undefined,
      limit: undefined,
    });
  });

  it("rejects out-of-range limits", () => {
    expect(searchProductsInputSchema.safeParse({ limit: 500 }).success).toBe(
      false,
    );
  });
});

describe("searchProductsStep", () => {
  it("maps products to summaries with the first image", async () => {
    vi.mocked(getProductsPage).mockResolvedValue({
      products: [product],
      pagination: pagination(),
    });
    const result = await searchProductsStep({
      query: "hoodie",
      category: undefined,
      page: undefined,
      limit: undefined,
    });
    expect(getProductsPage).toHaveBeenCalledWith({
      search: "hoodie",
      category: undefined,
      page: undefined,
      limit: SEARCH_DEFAULT_LIMIT,
    });
    expect(result).toEqual({
      status: "ok",
      query: "hoodie",
      category: null,
      match: "phrase",
      products: [
        {
          id: "hoodie_001",
          slug: "black-pullover-hoodie",
          name: "Black Pullover Hoodie",
          price: 6500,
          currency: "USD",
          priceFormatted: "$65.00",
          category: "hoodies",
          image: "https://example.com/a.jpg",
        },
      ],
      page: 1,
      pageSize: SEARCH_DEFAULT_LIMIT,
      totalPages: 1,
      total: 1,
      hasNextPage: false,
    });
  });

  it("returns an empty list (not an error) when nothing matches", async () => {
    vi.mocked(getProductsPage).mockResolvedValue({
      products: [],
      pagination: pagination({ total: 0, totalPages: 0 }),
    });
    const result = await searchProductsStep({
      query: "spaceship",
      category: undefined,
      page: undefined,
      limit: undefined,
    });
    expect(result).toMatchObject({ status: "ok", products: [], total: 0 });
  });

  it("falls back to keyword matches when a multi-word phrase has no match", async () => {
    const mug: Product = { ...product, id: "mug_001", name: "Black Mug" };
    const byWord: Record<string, Product[]> = {
      black: [product, mug],
      hoodie: [product],
    };
    vi.mocked(getProductsPage).mockImplementation(async (params = {}) => {
      const products = byWord[params.search ?? ""] ?? [];
      return Promise.resolve({
        products,
        pagination: pagination({ total: products.length }),
      });
    });
    const result = await searchProductsStep({
      query: "black hoodie",
      category: undefined,
      page: undefined,
      limit: undefined,
    });
    expect(result).toMatchObject({
      status: "ok",
      match: "keywords",
      total: 1,
      products: [{ id: "hoodie_001" }],
    });
  });

  it("searches a slug again as its phrase when it has no match", async () => {
    vi.mocked(getProductsPage).mockImplementation(async (params = {}) => {
      const products =
        params.search === "black pullover hoodie" ? [product] : [];
      return Promise.resolve({
        products,
        pagination: pagination({ total: products.length }),
      });
    });
    const result = await searchProductsStep({
      query: "black-pullover-hoodie",
      category: undefined,
      page: undefined,
      limit: undefined,
    });
    expect(result).toMatchObject({
      status: "ok",
      query: "black pullover hoodie",
      match: "phrase",
      products: [{ slug: "black-pullover-hoodie" }],
    });
  });

  it("reads only slug-shaped queries as a phrase", () => {
    expect(slugAsPhrase("Black-Pullover-Hoodie")).toBe("black pullover hoodie");
    expect(slugAsPhrase("t-shirt")).toBe("t shirt");
    expect(slugAsPhrase("black t-shirt")).toBeNull();
    expect(slugAsPhrase("hoodie")).toBeNull();
    expect(slugAsPhrase("-hoodie")).toBeNull();
  });

  it("splits queries into unique keywords of two or more characters", () => {
    expect(searchKeywords("Black  hoodie, a BLACK t-shirt")).toEqual([
      "black",
      "hoodie",
      "t-shirt",
    ]);
  });

  it("maps a rejected category to unknown_category with valid slugs", async () => {
    vi.mocked(getProductsPage).mockRejectedValue(
      new ApiRequestError(
        422,
        "VALIDATION_ERROR",
        "Invalid category 'spaceships'. Valid categories: hoodies, mugs",
      ),
    );
    vi.mocked(getCategories).mockResolvedValue(categories);
    await expect(
      searchProductsStep({
        query: undefined,
        category: "spaceships",
        page: undefined,
        limit: undefined,
      }),
    ).resolves.toEqual({
      status: "unknown_category",
      category: "spaceships",
      validCategories: ["hoodies", "mugs"],
    });
  });

  it("re-throws transient failures so the step retries", async () => {
    vi.mocked(getProductsPage).mockRejectedValue(apiError(500));
    await expect(
      searchProductsStep({
        query: "mug",
        category: undefined,
        page: undefined,
        limit: undefined,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("fails permanently (no retry) on other rejections", async () => {
    vi.mocked(getProductsPage).mockRejectedValue(apiError(400));
    await expect(
      searchProductsStep({
        query: "mug",
        category: undefined,
        page: undefined,
        limit: undefined,
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });
});

describe("getProductDetailsInputSchema", () => {
  it("requires a non-empty id or slug", () => {
    expect(
      getProductDetailsInputSchema.safeParse({ idOrSlug: " " }).success,
    ).toBe(false);
  });
});

describe("getProductDetailsStep", () => {
  it("returns details with all images and live stock", async () => {
    vi.mocked(getProductById).mockResolvedValue(product);
    vi.mocked(getProductStock).mockResolvedValue({
      productId: product.id,
      stock: 3,
      inStock: true,
      lowStock: true,
    });
    const result = await getProductDetailsStep({
      idOrSlug: "black-pullover-hoodie",
    });
    expect(result).toMatchObject({
      status: "ok",
      product: {
        slug: "black-pullover-hoodie",
        description: "Soft and warm.",
        images: product.images,
        tags: ["apparel"],
        price: 6500,
      },
      stock: { stock: 3, inStock: true, lowStock: true },
    });
  });

  it("returns not_found for an unknown product", async () => {
    vi.mocked(getProductById).mockRejectedValue(apiError(404));
    vi.mocked(getProductStock).mockRejectedValue(apiError(404));
    await expect(
      getProductDetailsStep({ idOrSlug: "spaceship" }),
    ).resolves.toEqual({ status: "not_found", idOrSlug: "spaceship" });
  });

  it("re-throws transient failures so the step retries", async () => {
    vi.mocked(getProductById).mockRejectedValue(apiError(0));
    vi.mocked(getProductStock).mockRejectedValue(apiError(0));
    await expect(
      getProductDetailsStep({ idOrSlug: "mug" }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});
