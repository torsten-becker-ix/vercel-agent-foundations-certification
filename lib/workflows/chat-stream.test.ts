import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  ANSWER_NUDGE,
  MODEL_STREAM_ATTEMPTS,
  type StepBudget,
  streamWithRecovery,
} from "./chat-stream";

vi.mock("workflow", () => ({}));

interface Step {
  text: string;
  toolCalls: { toolName: string }[];
}
interface Result {
  messages: ModelMessage[];
  steps: Step[];
}
interface Attempt {
  messages: ModelMessage[];
  onError: (event: { error: unknown }) => void;
  budget: StepBudget;
}

const user: ModelMessage = { role: "user", content: "return rates?" };
const toolResult: ModelMessage = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "c1",
      toolName: "getSalesAnalytics",
      output: { type: "json", value: {} },
    },
  ],
};
const partial: ModelMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Half an ans" }],
};
const answered: Step[] = [{ text: "Here you go.", toolCalls: [] }];
const silent: Step[] = [{ text: "", toolCalls: [] }];
const toolStep: Step[] = [
  { text: "", toolCalls: [{ toolName: "getSalesAnalytics" }] },
];

const mockStream = () => vi.fn<(attempt: Attempt) => Promise<Result>>();
const fail = async (attempt: Attempt, result: Result) => {
  attempt.onError({
    error: new Error("Failed to parse tool call arguments as JSON"),
  });
  return Promise.resolve(result);
};

describe("streamWithRecovery", () => {
  it("returns the first attempt when the model stream succeeds", async () => {
    const stream = mockStream().mockResolvedValue({
      messages: [user],
      steps: answered,
    });
    await expect(streamWithRecovery(stream, [user], 16)).resolves.toEqual({
      messages: [user],
      steps: answered,
    });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("retries after a model error from the completed steps, without the partial message or system messages", async () => {
    const stream = mockStream()
      .mockImplementationOnce(async (attempt) =>
        fail(attempt, {
          messages: [
            { role: "system", content: "instructions" },
            user,
            toolResult,
            partial,
          ],
          steps: [...toolStep, { text: "Half an ans", toolCalls: [] }],
        }),
      )
      .mockResolvedValueOnce({ messages: [user, toolResult], steps: answered });

    await streamWithRecovery(stream, [user], 16);

    expect(stream).toHaveBeenCalledTimes(2);
    const retry = stream.mock.calls[1]?.[0];
    expect(retry?.messages).toEqual([user, toolResult]);
    // The step budget carries over to the retry.
    expect(retry?.budget).toEqual({
      stepsUsed: 2,
      toolNames: ["getSalesAnalytics"],
    });
  });

  it("gives up after the last attempt and throws the model error", async () => {
    const stream = mockStream().mockImplementation(async (attempt) =>
      fail(attempt, { messages: [user], steps: toolStep }),
    );
    await expect(streamWithRecovery(stream, [user], 16)).rejects.toThrow(
      "Failed to parse tool call arguments",
    );
    expect(stream).toHaveBeenCalledTimes(MODEL_STREAM_ATTEMPTS);
  });

  it("doesn't retry when the step budget is used up", async () => {
    const stream = mockStream().mockImplementation(async (attempt) =>
      fail(attempt, { messages: [user], steps: [...toolStep, ...toolStep] }),
    );
    await expect(streamWithRecovery(stream, [user], 2)).rejects.toThrow();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("nudges once when the turn ends without answer text", async () => {
    const stream = mockStream()
      .mockResolvedValueOnce({ messages: [user, toolResult], steps: silent })
      .mockResolvedValueOnce({ messages: [user, toolResult], steps: silent });

    await streamWithRecovery(stream, [user], 16);

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[0].messages.at(-1)).toEqual({
      role: "user",
      content: ANSWER_NUDGE,
    });
  });

  it("doesn't nudge when the turn ends with a pending tool call (e.g. an approval)", async () => {
    const stream = mockStream().mockResolvedValue({
      messages: [user],
      steps: [{ text: "", toolCalls: [{ toolName: "returnOrder" }] }],
    });
    await streamWithRecovery(stream, [user], 16);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
