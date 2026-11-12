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
  searchProductsInputSchema,
  searchProductsStep,
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
      categories,
    });
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

  it("maps a rejected category to unknown_category with valid slugs", async () => {
    vi.mocked(getProductsPage).mockRejectedValue(apiError(422));
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
