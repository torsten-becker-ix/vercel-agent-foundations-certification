import { describe, expect, it } from "vitest";

import { adminInstructions, calendarFacts } from "./agent";

const friday = new Date("2026-11-13T10:00:00Z");

describe("adminInstructions", () => {
  it("states today's date with its weekday", () => {
    expect(adminInstructions(null, friday)).toContain(
      "today is Friday, 2026-11-13.",
    );
  });

  it("says when nothing is saved yet", () => {
    expect(adminInstructions(null, friday)).toContain(
      "Saved context: none yet.",
    );
    expect(adminInstructions("  ", friday)).toContain(
      "Saved context: none yet.",
    );
  });

  it("includes the saved memory", () => {
    const text = adminInstructions(
      "- 2026-11-13: Weeks start on Monday",
      friday,
    );
    expect(text).toContain("Weeks start on Monday");
    expect(text).not.toContain("none yet");
  });
});

describe("calendarFacts", () => {
  it("computes Monday-based weeks and months", () => {
    const facts = calendarFacts(friday);
    expect(facts).toContain(
      "This week (Monday–Sunday): 2026-11-09 to 2026-11-15",
    );
    expect(facts).toContain("Last week: 2026-11-02 to 2026-11-08");
    expect(facts).toContain("Last 7 days: 2026-11-07 to 2026-11-13");
    expect(facts).toContain("Last month: 2026-10-01 to 2026-10-31");
  });

  it("treats Sunday as the last day of the week", () => {
    expect(calendarFacts(new Date("2026-11-15T23:00:00Z"))).toContain(
      "This week (Monday–Sunday): 2026-11-09 to 2026-11-15",
    );
  });

  it("handles January (last month is December)", () => {
    expect(calendarFacts(new Date("2027-01-05T08:00:00Z"))).toContain(
      "Last month: 2026-12-01 to 2026-12-31",
    );
  });
});
