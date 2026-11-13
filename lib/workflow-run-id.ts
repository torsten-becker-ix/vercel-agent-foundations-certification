/** Workflow run ids look like `wrun_` + 26 Crockford base32 characters. */
const RUN_ID = /^wrun_[0-9A-Z]{26}$/;

export function isWorkflowRunId(value: string): boolean {
  return RUN_ID.test(value);
}
