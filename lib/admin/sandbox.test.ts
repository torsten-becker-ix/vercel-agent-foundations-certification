import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/sandbox", () => ({ Sandbox: { getOrCreate: vi.fn() } }));

const { BASH_OUTPUT_LIMIT, capOutput, dataFileName, isTimeout } =
  await import("./sandbox");

describe("dataFileName", () => {
  it("is stable per tool and filters, so a retry overwrites the same file", () => {
    const a = dataFileName("sales", { from: "2026-11-01" });
    expect(a).toMatch(/^data\/sales-[0-9a-f]{8}\.json$/);
    expect(dataFileName("sales", { from: "2026-11-01" })).toBe(a);
    expect(dataFileName("sales", { from: "2026-11-02" })).not.toBe(a);
  });
});

describe("capOutput", () => {
  it("keeps short output", () => {
    expect(capOutput("ok\n")).toEqual({ text: "ok\n", truncated: false });
  });

  it("cuts long output and says so", () => {
    const { text, truncated } = capOutput("x".repeat(BASH_OUTPUT_LIMIT + 10));
    expect(truncated).toBe(true);
    expect(text.endsWith("[output truncated]")).toBe(true);
  });
});

describe("isTimeout", () => {
  it("reports timeout's own exit code", () => {
    expect(isTimeout(124, 30_100)).toBe(true);
  });

  it("only counts a kill (137) as a timeout once the limit passed", () => {
    expect(isTimeout(137, 31_000)).toBe(true);
    // e.g. the kernel killed python for using too much memory
    expect(isTimeout(137, 2_000)).toBe(false);
  });

  it("isn't a timeout for normal exits", () => {
    expect(isTimeout(0, 100)).toBe(false);
    expect(isTimeout(3, 100)).toBe(false);
  });
});
