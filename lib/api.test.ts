import { afterEach, describe, expect, it, vi } from "vitest";

import { getBackOfficeStock, getProducts } from "./api";

function mockFetch() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ success: true, data: [], meta: {} }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof mockFetch>): URL {
  const [input] = fetchMock.mock.calls[0] ?? [];
  if (typeof input !== "string")
    throw new Error("fetch was not called with a URL string");
  return new URL(input);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query building", () => {
  it("omits undefined and empty values", async () => {
    const fetchMock = mockFetch();
    await getProducts({
      search: "",
      category: "hoodies",
      limit: 5,
      page: undefined,
    });
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toMatch(/\/products$/);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: "hoodies",
      limit: "5",
    });
  });

  it("keeps the bare path without params", async () => {
    const fetchMock = mockFetch();
    await getProducts();
    expect(requestedUrl(fetchMock).search).toBe("");
  });

  it("serializes booleans and comma-joins arrays", async () => {
    const fetchMock = mockFetch();
    await getBackOfficeStock({
      productIds: ["a", "b"],
      lowStock: false,
      inStock: true,
    });
    expect(Object.fromEntries(requestedUrl(fetchMock).searchParams)).toEqual({
      productIds: "a,b",
      lowStock: "false",
      inStock: "true",
    });
  });

  it("drops an empty array", async () => {
    const fetchMock = mockFetch();
    await getBackOfficeStock({ productIds: [] });
    expect(requestedUrl(fetchMock).search).toBe("");
  });
});

describe("protection bypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends the secret as a header, never in the URL", async () => {
    vi.stubEnv("BYPASS_SECRET", "test-bypass-secret");
    vi.resetModules();
    const api = await import("./api");
    const fetchMock = mockFetch();
    await api.getProducts({ limit: 1 });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestedUrl(fetchMock).href).not.toContain("test-bypass-secret");
    expect(new Headers(init?.headers).get("x-vercel-protection-bypass")).toBe(
      "test-bypass-secret",
    );
  });
});
