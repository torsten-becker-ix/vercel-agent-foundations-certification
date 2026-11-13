/**
 * Site identity for metadata, robots and sitemap.
 *
 * URL order: an explicit `NEXT_PUBLIC_SITE_URL`, then Vercel's production
 * domain (a system env var on every Vercel deployment, so previews also point
 * canonical/OG URLs at production), then localhost for `next dev`.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL === undefined
    ? "http://localhost:3000"
    : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);

export const SITE_NAME = "Ship It Shop";

export const SITE_DESCRIPTION =
  "Premium merchandise for developers who ship fast. High-quality apparel and accessories for the modern web.";
