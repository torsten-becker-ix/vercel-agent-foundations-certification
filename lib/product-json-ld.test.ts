import { describe, expect, it } from "vitest";

import { productJsonLd, serializeJsonLd } from "./product-json-ld";
import type { Product } from "./types";

const product: Product = {
  id: "hoodie_001",
  name: "Black Pullover Hoodie",
  slug: "black-pullover-hoodie",
  description: "Soft, minimal hoodie.",
  price: 6000,
  currency: "USD",
  category: "hoodies",
  images: ["https://x.public.blob.vercel-storage.com/hoodie.png"],
  featured: false,
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
};

describe("productJsonLd", () => {
  it("describes the product with an offer in currency units", () => {
    const url = "https://shop.example/products/hoodie_001";
    expect(productJsonLd(product, url)).toMatchObject({
      "@type": "Product",
      name: "Black Pullover Hoodie",
      sku: "hoodie_001",
      offers: { "@type": "Offer", price: "60.00", priceCurrency: "USD", url },
    });
  });
});

describe("serializeJsonLd", () => {
  it("can't close the surrounding script tag", () => {
    const json = serializeJsonLd({ description: "</script><script>alert(1)" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual({
      description: "</script><script>alert(1)",
    });
  });
});
