import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";

import { lookupReturnCheck } from "./return-check";
import { returnOrderExecute } from "./tools";

vi.mock("workflow/api", () => ({ start: vi.fn(), getRun: vi.fn() }));
vi.mock("./return-check", () => ({ lookupReturnCheck: vi.fn() }));
vi.mock("./workflows/return-flow", () => ({ returnFlow: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("returnOrderExecute", () => {
  it("starts one return workflow and reports it filed right away", async () => {
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
    expect(result).toEqual({
      status: "filed",
      orderId: "11111",
      returnRunId: "wrun_RETURN",
      items: [],
    });
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
