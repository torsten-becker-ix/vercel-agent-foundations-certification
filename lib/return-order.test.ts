import { afterEach, describe, expect, it, vi } from "vitest";
import { getRun, start } from "workflow/api";
import { HookConflictError } from "workflow/errors";

import type * as ApiModule from "./api";
import { getReturn } from "./api";
import { lookupReturnCheck } from "./return-check";
import { getReturnStatusStep, returnOrderExecute } from "./tools";

vi.mock("workflow/api", () => ({ start: vi.fn(), getRun: vi.fn() }));
vi.mock("./return-check", () => ({ lookupReturnCheck: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getReturn: vi.fn(),
}));
vi.mock("./workflows/return-flow", () => ({ returnFlow: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("returnOrderExecute", () => {
  it("starts one return workflow and reports it submitted right away", async () => {
    vi.mocked(lookupReturnCheck).mockResolvedValue({
      status: "eligible",
      orderId: "11111",
      items: [],
      totalFormatted: "$108.00",
    });
    vi.mocked(start).mockResolvedValue({ runId: "wrun_RETURN" } as never);

    const result = await returnOrderExecute({
      orderId: "11111",
      reason: "wrong size",
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.mocked(start).mock.calls[0]?.[1]).toEqual([
      { orderId: "11111", reason: "wrong size" },
    ]);
    // One return per order at a time: the order id is the idempotency token.
    // `start` is overloaded; the mock's call type only knows the last overload.
    const [, , options] = (vi.mocked(start).mock.calls[0] ?? []) as unknown[];
    expect(options).toEqual({
      experimental_hook: { token: "return:order:11111" },
    });
    expect(result).toEqual({
      status: "submitted",
      orderId: "11111",
      returnRunId: "wrun_RETURN",
      items: [],
    });
  });

  it("reuses the running return instead of starting a second one", async () => {
    vi.mocked(lookupReturnCheck).mockResolvedValue({
      status: "eligible",
      orderId: "11111",
      items: [],
      totalFormatted: "$108.00",
    });
    vi.mocked(start).mockRejectedValue(
      new HookConflictError("return:order:11111", "wrun_OWNER", {
        kind: "start",
      }),
    );

    const result = await returnOrderExecute({
      orderId: "11111",
      reason: "wrong size",
    });

    expect(result).toMatchObject({
      status: "submitted",
      returnRunId: "wrun_OWNER",
    });
  });

  it("still fails on other start errors", async () => {
    vi.mocked(lookupReturnCheck).mockResolvedValue({
      status: "eligible",
      orderId: "11111",
      items: [],
      totalFormatted: "$108.00",
    });
    vi.mocked(start).mockRejectedValue(new Error("world down"));
    await expect(
      returnOrderExecute({ orderId: "11111", reason: "wrong size" }),
    ).rejects.toThrow("world down");
  });

  it("never starts a workflow for ineligible or unknown orders", async () => {
    vi.mocked(lookupReturnCheck).mockResolvedValue({
      status: "not_eligible",
      orderId: "44444",
      orderStatus: "paid",
      explanation: "not shipped",
    });
    await expect(
      returnOrderExecute({ orderId: "44444", reason: "changed my mind" }),
    ).resolves.toMatchObject({ status: "not_eligible" });

    vi.mocked(lookupReturnCheck).mockResolvedValue({
      status: "not_found",
      orderId: "99999",
    });
    await expect(
      returnOrderExecute({ orderId: "99999", reason: "wrong size" }),
    ).resolves.toMatchObject({ status: "not_found" });

    expect(start).not.toHaveBeenCalled();
  });
});

describe("getReturnStatusStep", () => {
  const RUN_ID = "wrun_01M79ZSEGX6ESSWSJ60677HGQW";

  function mockRun(workflowName: string, returnValue: unknown = {}) {
    vi.mocked(getRun).mockReturnValue({
      exists: Promise.resolve(true),
      workflowName: Promise.resolve(workflowName),
      status: Promise.resolve("completed"),
      returnValue: Promise.resolve(returnValue),
    } as never);
  }
  const RETURN_FLOW = "workflow//./lib/workflows/return-flow//returnFlow";
  const stillPending = {
    status: "pending",
    orderId: "11111",
    returnId: "ret_1",
    currency: "USD",
  };

  it("refuses a run of another workflow (e.g. a chat run)", async () => {
    mockRun("workflow//./lib/workflows/chat-flow//shoppingChatFlow", {
      messages: ["secret conversation"],
    });
    expect(await getReturnStatusStep({ returnRunId: RUN_ID })).toEqual({
      status: "not_found",
      returnRunId: RUN_ID,
    });
  });

  it("answers for a returnFlow run", async () => {
    mockRun(RETURN_FLOW, {
      status: "decided",
      orderId: "11111",
      returnId: "ret_1",
      decision: "approved",
      refundFormatted: "$60.00",
      notes: null,
    });
    const result = await getReturnStatusStep({ returnRunId: RUN_ID });
    expect(result).toMatchObject({
      status: "done",
      outcome: { decision: "approved" },
    });
    expect(getReturn).not.toHaveBeenCalled();
  });

  it("looks up a decision that arrived after the workflow stopped polling", async () => {
    mockRun(RETURN_FLOW, stillPending);
    vi.mocked(getReturn).mockResolvedValue({
      id: "ret_1",
      orderId: "11111",
      status: "completed",
      decision: "approved",
      refundAmount: 6000,
      notes: null,
    } as never);
    const result = await getReturnStatusStep({ returnRunId: RUN_ID });
    expect(result).toMatchObject({
      status: "done",
      outcome: { status: "decided", refundFormatted: "$60.00" },
    });
  });

  it("stays pending when the live lookup fails", async () => {
    mockRun(RETURN_FLOW, stillPending);
    vi.mocked(getReturn).mockRejectedValue(new Error("store down"));
    const result = await getReturnStatusStep({ returnRunId: RUN_ID });
    expect(result).toMatchObject({ status: "done", outcome: stillPending });
  });
});
