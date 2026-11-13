import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Admin check for API routes. `proxy.ts` only guards `/admin/:path*` pages,
 * so `/api/admin/*` must check the cookie itself. Same demo-grade rule as the
 * proxy (cookie value = password), compared in constant time.
 */
export async function isAdminRequest(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (value === undefined) return false;
  return timingSafeEqual(digest(value), digest(ADMIN_PASSWORD));
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
