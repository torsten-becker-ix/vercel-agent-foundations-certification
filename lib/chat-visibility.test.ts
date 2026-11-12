import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { answerTextIndexes } from "./chat-visibility";

type Part = UIMessage["parts"][number];

const step: Part = { type: "step-start" };
const text = (value: string): Part => ({ type: "text", text: value });
const toolCall: Part = {
  type: "tool-searchProducts",
  toolCallId: "call_1",
  state: "output-available",
  input: {},
  output: {},
};

describe("answerTextIndexes", () => {
  it("keeps text from steps without tool calls", () => {
    expect(answerTextIndexes({ parts: [step, text("Hi")] })).toEqual(
      new Set([1]),
    );
  });

  it("hides text written in the same step as a tool call", () => {
    const parts = [step, text("Guess…"), toolCall, step, text("Answer")];
    expect(answerTextIndexes({ parts })).toEqual(new Set([4]));
  });

  it("treats a message without step markers as one step", () => {
    expect(answerTextIndexes({ parts: [text("A"), toolCall] })).toEqual(
      new Set(),
    );
  });
});
