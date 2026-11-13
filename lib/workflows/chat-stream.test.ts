import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { MODEL_STREAM_ATTEMPTS, streamWithRecovery } from "./chat-stream";

vi.mock("workflow", () => ({}));

const user: ModelMessage = { role: "user", content: "return rates?" };
const toolStep: ModelMessage = {
  role: "assistant",
  content: [{ type: "text", text: "(tool calls)" }],
};

describe("streamWithRecovery", () => {
  it("returns the first attempt when the model stream succeeds", async () => {
    const stream = vi.fn(async () =>
      Promise.resolve({ messages: [user, toolStep] }),
    );
    await expect(streamWithRecovery(stream, [user])).resolves.toEqual({
      messages: [user, toolStep],
    });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("continues from the conversation so far after a model error, without system messages", async () => {
    const stream = vi
      .fn<
        (options: {
          messages: ModelMessage[];
          onError: (event: { error: unknown }) => void;
        }) => Promise<{ messages: ModelMessage[] }>
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
        });
      })
      .mockImplementationOnce(async () =>
        Promise.resolve({ messages: [user, toolStep] }),
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
        return Promise.resolve({ messages: [user] });
      },
    );
    await expect(streamWithRecovery(stream, [user])).rejects.toBe(error);
    expect(stream).toHaveBeenCalledTimes(MODEL_STREAM_ATTEMPTS);
  });
});
