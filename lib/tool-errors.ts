/**
 * Error contract for tool steps: transient store-API failures are re-thrown
 * (the workflow step retries them); other rejections become non-retryable.
 */
import { FatalError } from "workflow";

import { ApiRequestError } from "./api";

export function isApiStatus(
  error: unknown,
  status: number,
): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === status;
}

/** Transient = worth retrying: network failure (status 0), rate limit, 5xx. */
export function isTransientApiError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

/** Re-throws transient errors (step retry) and wraps the rest as non-retryable. */
export function rethrow(error: unknown, action: string): never {
  if (isTransientApiError(error)) throw error;
  const status = error instanceof ApiRequestError ? error.status : "unknown";
  throw new FatalError(
    `${action} was rejected by the store API (status ${String(status)}).`,
  );
}
