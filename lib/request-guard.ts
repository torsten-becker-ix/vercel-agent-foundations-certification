/**
 * Guards for JSON `POST` routes that start paid work (model runs).
 *
 * - Content type must be JSON (415). A cross-site `<form>` or `text/plain`
 *   "simple request" can't send `application/json` without a CORS preflight,
 *   which this app never allows.
 * - A browser `Origin` from another site is rejected (403). Requests without
 *   `Origin` (curl, server-side) are allowed; browsers always send it on POST.
 * - The body is capped (413), checked on `Content-Length` and on the actual
 *   bytes read, so a missing or false header doesn't bypass it.
 */
export type JsonBodyResult =
  { ok: true; json: unknown } | { ok: false; response: Response };

function fail(status: number, error: string): JsonBodyResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}

/** The host the browser talked to (Vercel forwards it). */
function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host
  );
}

export function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== requestHost(request);
  } catch {
    return true; // "null" (sandboxed iframe, file://) or garbage
  }
}

export async function readJsonBody(
  request: Request,
  { maxBytes }: { maxBytes: number },
): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return fail(415, "unsupported_media_type");
  }
  if (isForeignOrigin(request)) return fail(403, "forbidden_origin");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return fail(413, "payload_too_large");

  let text: string;
  try {
    text = await request.text();
  } catch {
    return fail(400, "invalid_body");
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return fail(413, "payload_too_large");
  }

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return fail(400, "invalid_json");
  }
}
