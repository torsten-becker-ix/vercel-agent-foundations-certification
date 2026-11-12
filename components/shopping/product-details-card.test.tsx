import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductDetail } from "@/lib/tools";

import { ProductDetailsCard } from "./product-details-card";

const product = (images: string[]): ProductDetail => ({
  id: "hoodie_001",
  slug: "black-pullover-hoodie",
  name: "Black Pullover Hoodie",
  price: 6000,
  currency: "USD",
  priceFormatted: "$60.00",
  category: "hoodies",
  image: images[0] ?? null,
  images,
  tags: [],
  description: "Soft, minimal, and easy to layer.",
});

const render = (
  images: string[],
  stock = { stock: 3, inStock: true, lowStock: true },
) =>
  renderToStaticMarkup(
    <ProductDetailsCard product={product(images)} stock={stock} />,
  );

describe("ProductDetailsCard", () => {
  it("shows name, price, description, stock and a product link", () => {
    const html = render(["https://example.com/a.png"]);
    expect(html).toContain("Black Pullover Hoodie");
    expect(html).toContain("$60.00");
    expect(html).toContain("Soft, minimal, and easy to layer.");
    expect(html).toContain("Only 3 left in stock");
    expect(html).toContain('href="/products/hoodie_001"');
  });

  it("has no gallery for a single image", () => {
    expect(render(["https://example.com/a.png"])).not.toContain("Show image");
  });

  it("offers one pressed thumbnail button per image", () => {
    const html = render([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    expect(html).toContain('aria-label="Show image 1 of 2"');
    expect(html).toContain('aria-label="Show image 2 of 2"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("Black Pullover Hoodie, image 1 of 2");
  });

  it("says out of stock", () => {
    expect(
      render(["https://example.com/a.png"], {
        stock: 0,
        inStock: false,
        lowStock: false,
      }),
    ).toContain("Out of stock");
  });
});
