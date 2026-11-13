import { describe, expect, it } from "vitest";

import { readJsonBody } from "./request-guard";

const URL_ = "https://shop.example/api/chat";

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function status(request: Request, maxBytes = 1000) {
  const result = await readJsonBody(request, { maxBytes });
  return result.ok ? 200 : result.response.status;
}

describe("readJsonBody", () => {
  it("parses a same-origin JSON body", async () => {
    const result = await readJsonBody(
      post('{"a":1}', { origin: "https://shop.example" }),
      { maxBytes: 1000 },
    );
    expect(result).toEqual({ ok: true, json: { a: 1 } });
  });

  it("allows requests without an Origin header", async () => {
    expect(await status(post("{}"))).toBe(200);
  });

  it("accepts a charset parameter", async () => {
    const request = post("{}", {
      "content-type": "application/json; charset=utf-8",
    });
    expect(await status(request)).toBe(200);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", ""])(
    "rejects content type %j with 415",
    async (contentType) => {
      expect(await status(post("{}", { "content-type": contentType }))).toBe(
        415,
      );
    },
  );

  it.each(["https://evil.example", "null", "http://shop.example.evil.test"])(
    "rejects origin %j with 403",
    async (origin) => {
      expect(await status(post("{}", { origin }))).toBe(403);
    },
  );

  it("uses the forwarded host behind a proxy", async () => {
    const request = post("{}", {
      origin: "https://alias.example",
      "x-forwarded-host": "alias.example",
    });
    expect(await status(request)).toBe(200);
  });

  it("rejects a body over the limit with 413, even without Content-Length", async () => {
    expect(await status(post(JSON.stringify("x".repeat(2000))))).toBe(413);
  });

  it("counts bytes, not characters", async () => {
    // 400 × "€" = 1200 bytes in UTF-8, but only 402 characters.
    expect(await status(post(JSON.stringify("€".repeat(400))))).toBe(413);
  });

  it("rejects invalid JSON with 400", async () => {
    expect(await status(post("{"))).toBe(400);
  });
});
