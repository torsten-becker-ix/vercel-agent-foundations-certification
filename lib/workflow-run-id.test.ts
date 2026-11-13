import { describe, expect, it } from "vitest";

import { isRunOfWorkflow, isWorkflowRunId } from "./workflow-run-id";

describe("isWorkflowRunId", () => {
  it("accepts a run id and rejects anything else", () => {
    expect(isWorkflowRunId("wrun_01M79ZSEGX6ESSWSJ60677HGQW")).toBe(true);
    expect(isWorkflowRunId("wrun_../admin")).toBe(false);
    expect(isWorkflowRunId("01M79ZSEGX6ESSWSJ60677HGQW")).toBe(false);
  });
});

describe("isRunOfWorkflow", () => {
  const chat = "workflow//./lib/workflows/chat-flow//shoppingChatFlow";
  const ret = "workflow//./lib/workflows/return-flow//returnFlow";

  it("matches the workflow by its export name", () => {
    expect(isRunOfWorkflow(chat, "shoppingChatFlow")).toBe(true);
    expect(isRunOfWorkflow(ret, "returnFlow")).toBe(true);
  });

  it("rejects other workflows", () => {
    expect(isRunOfWorkflow(ret, "shoppingChatFlow")).toBe(false);
    expect(isRunOfWorkflow(chat, "returnFlow")).toBe(false);
    expect(
      isRunOfWorkflow(
        "workflow//./lib/workflows/admin-chat-flow//adminChatFlow",
        "shoppingChatFlow",
      ),
    ).toBe(false);
  });
});
