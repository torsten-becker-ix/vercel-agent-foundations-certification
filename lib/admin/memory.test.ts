import { describe, expect, it, vi } from "vitest";

vi.mock("./sandbox", () => ({ getAdminSandbox: vi.fn() }));

const { appendNote, memoryForPrompt, MEMORY_PROMPT_MAX, normalizeNote } =
  await import("./memory");

const day = new Date("2026-11-13T10:00:00Z");

describe("appendNote", () => {
  it("starts a memory file with a dated bullet", () => {
    expect(appendNote(null, "Revenue in EUR thousands", day)).toEqual({
      content: "- 2026-11-13: Revenue in EUR thousands\n",
      added: true,
    });
  });

  it("appends to existing notes", () => {
    const current = "- 2026-11-12: Alex owns shipping tickets\n";
    expect(appendNote(current, "Weeks start on Monday", day).content).toBe(
      "- 2026-11-12: Alex owns shipping tickets\n- 2026-11-13: Weeks start on Monday\n",
    );
  });

  it("skips a duplicate (case and whitespace ignored), so retries are safe", () => {
    const current = "- 2026-11-12: Weeks start on Monday\n";
    expect(appendNote(current, "  weeks   start on monday ", day)).toEqual({
      content: current,
      added: false,
    });
  });

  it("keeps a note on one line", () => {
    expect(normalizeNote("line one\n\n# heading\n- bullet")).toBe(
      "line one # heading - bullet",
    );
  });
});

describe("memoryForPrompt", () => {
  it("is null when nothing is saved", () => {
    expect(memoryForPrompt(null)).toBeNull();
    expect(memoryForPrompt("  \n")).toBeNull();
  });

  it("keeps the newest notes when the file is too long", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `- 2026-11-13: note ${String(i)} ${"x".repeat(40)}`,
    );
    const result = memoryForPrompt(lines.join("\n")) ?? "";
    expect(result.length).toBeLessThanOrEqual(MEMORY_PROMPT_MAX);
    expect(result).toContain("note 199");
    expect(result).not.toContain("note 0 ");
  });
});
