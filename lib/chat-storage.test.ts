import { describe, expect, it } from "vitest";

import { EMPTY_CHAT, parseStoredChat, serializeChat } from "./chat-storage";
import type { ShoppingUIMessage } from "./chat-types";

const RUN_ID = "wrun_01KA0000000000000000000000";

const messages: ShoppingUIMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "Show me hoodies" }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [{ type: "step-start" }, { type: "text", text: "One hoodie." }],
  },
];

describe("parseStoredChat", () => {
  it("round-trips messages and the active run id", () => {
    const chat = { messages, activeRunId: RUN_ID };
    expect(parseStoredChat(serializeChat(chat))).toEqual(chat);
  });

  it("returns an empty chat when nothing is stored", () => {
    expect(parseStoredChat(null)).toBe(EMPTY_CHAT);
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[]"],
    ["another version", JSON.stringify({ version: 0, messages: [] })],
    ["messages that aren't an array", JSON.stringify({ version: 1 })],
    [
      "a message with an unknown role",
      JSON.stringify({
        version: 1,
        messages: [{ id: "m1", role: "system", parts: [] }],
      }),
    ],
    [
      "a part without a type",
      JSON.stringify({
        version: 1,
        messages: [{ id: "m1", role: "user", parts: [{ text: "hi" }] }],
      }),
    ],
  ])("ignores %s", (_label, raw) => {
    expect(parseStoredChat(raw)).toBe(EMPTY_CHAT);
  });

  it("keeps the messages but drops a malformed run id", () => {
    const raw = JSON.stringify({
      version: 1,
      messages,
      activeRunId: "../admin",
    });
    expect(parseStoredChat(raw)).toEqual({ messages, activeRunId: null });
  });
});
