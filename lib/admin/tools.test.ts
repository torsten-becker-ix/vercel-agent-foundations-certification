import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBackOfficeReturns,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getProducts,
  getStoreConfig,
} from "@/lib/api";

import { writeDataFile } from "./sandbox";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getBackOfficeSupportTickets: vi.fn(),
  getBackOfficeReturns: vi.fn(),
  getBackOfficeStock: vi.fn(),
  getStoreConfig: vi.fn(),
  getProducts: vi.fn(),
}));
vi.mock("./sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof SandboxModule>()),
  writeDataFile: vi.fn(async (path: string) => Promise.resolve(path)),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { getOrCreate: vi.fn() } }));

import type * as ApiModule from "@/lib/api";

import type * as SandboxModule from "./sandbox";
import {
  getInventoryStockStep,
  getReturnsHistoryStep,
  getSupportTicketsStep,
  inventoryStockInputSchema,
  returnsHistoryInputSchema,
  supportTicketsInputSchema,
} from "./tools";

afterEach(() => {
  vi.clearAllMocks();
});

const meta = {
  count: 1,
  from: "2026-10-14T00:00:00Z",
  to: "2026-11-13T00:00:00Z",
};

describe("getSupportTicketsStep", () => {
  it("never passes customer emails to the model or the sandbox", async () => {
    vi.mocked(getBackOfficeSupportTickets).mockResolvedValue({
      data: [
        {
          id: "tkt_1",
          subject: "Cap too tight",
          status: "open",
          priority: "high",
          category: "sizing",
          customerEmail: "d.park@example.com",
          relatedOrderId: null,
          relatedReturnId: null,
          assignee: "jamie",
          messagePreview: "Adjustable strap is at its loosest setting.",
          createdAt: "2026-11-13T00:00:00Z",
          updatedAt: "2026-11-13T00:00:00Z",
          lastMessageAt: "2026-11-13T00:00:00Z",
        },
      ],
      meta,
    });

    const result = await getSupportTicketsStep(
      supportTicketsInputSchema.parse({}),
    );

    expect(JSON.stringify(result)).not.toContain("example.com");
    const [, rows] = vi.mocked(writeDataFile).mock.calls[0] ?? [];
    expect(JSON.stringify(rows)).not.toContain("example.com");
    expect(result).toMatchObject({
      count: 1,
      file: expect.stringMatching(/^data\//) as unknown,
    });
  });
});

describe("getReturnsHistoryStep", () => {
  it("drops the webhook URL and formats refunds", async () => {
    vi.mocked(getStoreConfig).mockResolvedValue({ currency: "USD" } as never);
    vi.mocked(getProducts).mockResolvedValue([
      { id: "backpack_001", name: "Minimal Black Backpack" },
    ] as never);
    vi.mocked(getBackOfficeReturns).mockResolvedValue({
      data: [
        {
          id: "ret_1",
          orderId: "99004",
          callback:
            "https://shop.example/.well-known/workflow/v1/webhook/secret-token",
          items: [{ productId: "backpack_001", quantity: 1 }],
          reason: "Quality",
          status: "completed",
          scheduledFireAt: "2026-11-12T00:00:00Z",
          decision: "approved",
          refundAmount: 6500,
          notes: null,
          createdAt: "2026-11-12T00:00:00Z",
          updatedAt: "2026-11-12T00:00:00Z",
          processedAt: "2026-11-12T00:00:00Z",
          order: null,
        },
      ],
      meta,
    });

    const result = await getReturnsHistoryStep(
      returnsHistoryInputSchema.parse({}),
    );

    expect(JSON.stringify(result)).not.toContain("secret-token");
    const [, rows] = vi.mocked(writeDataFile).mock.calls[0] ?? [];
    expect(JSON.stringify(rows)).not.toContain("secret-token");
    expect(result.sample[0]).toMatchObject({ refundFormatted: "$65.00" });
    // Item names from the catalog, so rankings need no product lookups.
    expect(JSON.stringify(rows)).toContain("Minimal Black Backpack");
  });
});

describe("getInventoryStockStep", () => {
  it("caps the page size at the API maximum", async () => {
    vi.mocked(getBackOfficeStock).mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          page: 1,
          limit: 100,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    });
    const input = inventoryStockInputSchema.parse({
      lowStock: true,
      limit: 500,
    });
    await getInventoryStockStep(input);
    expect(getBackOfficeStock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, lowStock: true }),
    );
  });
});
