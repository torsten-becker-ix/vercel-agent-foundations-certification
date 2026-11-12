import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";

describe("formatPrice", () => {
  it("formats integer cents as USD", () => {
    expect(formatPrice(3500)).toBe("$35.00");
  });

  it("keeps sub-dollar precision", () => {
    expect(formatPrice(1999)).toBe("$19.99");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("$0.00");
  });
});
