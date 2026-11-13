import type { Product } from "@/lib/types";

/**
 * schema.org `Product` + `Offer` for a product page (rich results / GEO).
 *
 * No `availability`: stock is live (fetched client-side) while the page is
 * statically generated, so a build-time value would go stale.
 */
export function productJsonLd(product: Product, pageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images,
    sku: product.id,
    category: product.category,
    url: pageUrl,
    offers: {
      "@type": "Offer",
      url: pageUrl,
      // API prices are integer cents; schema.org wants currency units.
      price: (product.price / 100).toFixed(2),
      priceCurrency: product.currency,
    },
  };
}

/**
 * JSON for an inline `<script type="application/ld+json">`. Escapes `<` so a
 * product text containing `</script>` can't close the tag.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
