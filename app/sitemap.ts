import type { MetadataRoute } from "next";

import { getProducts } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

/** Storefront pages plus every product (same source as the SSG product pages). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, changeFrequency: "daily", priority: 0.8 },
  ];
  try {
    const products = await getProducts({ limit: 100 });
    return [
      ...pages,
      ...products.map((product) => ({
        url: `${SITE_URL}/products/${product.id}`,
        lastModified: product.createdAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    // Store API down at build time: still serve the static pages.
    return pages;
  }
}
