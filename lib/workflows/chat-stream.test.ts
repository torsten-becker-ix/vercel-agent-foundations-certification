import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  ANSWER_NUDGE,
  MODEL_STREAM_ATTEMPTS,
  streamWithRecovery,
} from "./chat-stream";

vi.mock("workflow", () => ({}));

const user: ModelMessage = { role: "user", content: "return rates?" };
const toolStep: ModelMessage = {
  role: "assistant",
  content: [{ type: "text", text: "(tool calls)" }],
};

const answered = [{ text: "Here you go.", toolCalls: [] as unknown[] }];
const silent = [{ text: "", toolCalls: [] as unknown[] }];

describe("streamWithRecovery", () => {
  it("returns the first attempt when the model stream succeeds", async () => {
    const stream = vi.fn(async () =>
      Promise.resolve({ messages: [user, toolStep], steps: answered }),
    );
    await expect(streamWithRecovery(stream, [user])).resolves.toEqual({
      messages: [user, toolStep],
      steps: answered,
    });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("continues from the conversation so far after a model error, without system messages", async () => {
    const stream = vi
      .fn<
        (options: {
          messages: ModelMessage[];
          onError: (event: { error: unknown }) => void;
        }) => Promise<{ messages: ModelMessage[]; steps: typeof answered }>
      >()
      .mockImplementationOnce(async ({ onError }) => {
        onError({
          error: new Error("Failed to parse tool call arguments as JSON"),
        });
        return Promise.resolve({
          messages: [
            { role: "system", content: "instructions" },
            user,
            toolStep,
          ],
          steps: answered,
        });
      })
      .mockImplementationOnce(async () =>
        Promise.resolve({ messages: [user, toolStep], steps: answered }),
      );

    await streamWithRecovery(stream, [user]);

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[0].messages).toEqual([user, toolStep]);
  });

  it("gives up after the last attempt and throws the model error", async () => {
    const error = new Error("still broken");
    const stream = vi.fn(
      async ({ onError }: { onError: (event: { error: unknown }) => void }) => {
        onError({ error });
        return Promise.resolve({ messages: [user], steps: answered });
      },
    );
    await expect(streamWithRecovery(stream, [user])).rejects.toBe(error);
    expect(stream).toHaveBeenCalledTimes(MODEL_STREAM_ATTEMPTS);
  });

  it("nudges once when the turn ends without answer text", async () => {
    const stream = vi
      .fn<
        (options: {
          messages: ModelMessage[];
          onError: (event: { error: unknown }) => void;
        }) => Promise<{ messages: ModelMessage[]; steps: typeof answered }>
      >()
      .mockResolvedValueOnce({ messages: [user, toolStep], steps: silent })
      .mockResolvedValueOnce({ messages: [user, toolStep], steps: silent });

    await streamWithRecovery(stream, [user]);

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[0].messages.at(-1)).toEqual({
      role: "user",
      content: ANSWER_NUDGE,
    });
  });

  it("doesn't nudge when the turn ends with a pending tool call (e.g. an approval)", async () => {
    const stream = vi.fn(async () =>
      Promise.resolve({
        messages: [user],
        steps: [
          { text: "", toolCalls: [{ toolName: "returnOrder" }] as unknown[] },
        ],
      }),
    );
    await streamWithRecovery(stream, [user]);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
