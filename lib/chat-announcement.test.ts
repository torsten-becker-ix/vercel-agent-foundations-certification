import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { announcementText } from "./chat-announcement";

const reply = (...texts: string[]): Pick<UIMessage, "parts"> => ({
  parts: [
    { type: "step-start" },
    ...texts.map((text) => ({ type: "text" as const, text })),
  ],
});

describe("announcementText", () => {
  it("strips Markdown emphasis, code and headings", () => {
    expect(
      announcementText(
        reply("## Hoodies\n\nThe **Black** hoodie is `$60.00`."),
      ),
    ).toBe("Hoodies The Black hoodie is $60.00.");
  });

  it("keeps link and image text, drops URLs", () => {
    expect(
      announcementText(
        reply("See [the hoodie](/products/x) ![Hoodie](/a.png)"),
      ),
    ).toBe("See the hoodie Hoodie");
  });

  it("drops list markers", () => {
    expect(
      announcementText(reply("Two mugs:\n- Black $18.00\n1. Travel $28.00")),
    ).toBe("Two mugs: Black $18.00 Travel $28.00");
  });

  it("joins text parts and ignores others", () => {
    expect(announcementText(reply("Hello ", "world"))).toBe("Hello world");
  });

  it("returns an empty string without text", () => {
    expect(announcementText(reply())).toBe("");
  });
});
