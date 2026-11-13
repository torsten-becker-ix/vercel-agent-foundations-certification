/** Workflow run ids look like `wrun_` + 26 Crockford base32 characters. */
const RUN_ID = /^wrun_[0-9A-Z]{26}$/;

export function isWorkflowRunId(value: string): boolean {
  return RUN_ID.test(value);
}

/**
 * Whether a run's `workflowName` belongs to the workflow exported as
 * `exportName`. Names look like `workflow//./lib/workflows/chat-flow//shoppingChatFlow`
 * (module path + export), so the export name is the stable part.
 *
 * Run ids reach the server from the client (resume URL, tool inputs copied by
 * the model), so every lookup checks the run is the expected kind before it
 * streams or returns anything.
 */
export function isRunOfWorkflow(
  workflowName: string,
  exportName: "shoppingChatFlow" | "returnFlow",
): boolean {
  return workflowName.endsWith(`//${exportName}`);
}
