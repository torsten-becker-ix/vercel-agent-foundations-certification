import "server-only";

import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

/**
 * The admin agent's Vercel Sandbox: one **named, persistent** sandbox per
 * environment. Its filesystem is snapshotted when a session stops and comes
 * back on the next call, so it holds both the computation workspace
 * (`data/`) and the memory file (`memory/`) across conversations.
 *
 * - `deny-all` network: code in the VM never needs the internet; store data
 *   is fetched by the app (with the API secret) and written in as files.
 * - No secrets in its environment.
 * - Paths are relative to the sandbox home (SDK 3.x: `/vercel`).
 *
 * A `Sandbox` handle isn't serializable, so every workflow step gets its own.
 */
export const ADMIN_SANDBOX_NAME = `ship-it-shop-admin-${process.env.VERCEL_ENV ?? "development"}`;

/** One session; a later call resumes a stopped sandbox automatically. */
const SESSION_TIMEOUT_MS = 10 * 60_000;

export async function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: ADMIN_SANDBOX_NAME,
    persistent: true,
    networkPolicy: "deny-all",
    resources: { vcpus: 1 },
    timeout: SESSION_TIMEOUT_MS,
    keepLastSnapshots: { count: 1 },
  });
}

export const DATA_DIR = "data";

/** Stable name per tool + filters, so a step retry overwrites the same file. */
export function dataFileName(tool: string, params: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);
  return `${DATA_DIR}/${tool}-${hash}.json`;
}

/**
 * Writes rows as JSON into the sandbox for `bash`. Returns the path, or null
 * when the sandbox is unavailable (the tool result still has a summary).
 */
export async function writeDataFile(
  path: string,
  rows: unknown,
): Promise<string | null> {
  try {
    const sandbox = await getAdminSandbox();
    await sandbox.writeFiles([
      { path, content: Buffer.from(JSON.stringify(rows, null, 1)) },
    ]);
    return path;
  } catch (error) {
    console.error("[admin sandbox] writing a data file failed:", error);
    return null;
  }
}

/** Limits for one `bash` call. */
export const BASH_TIMEOUT_SECONDS = 30;
export const BASH_OUTPUT_LIMIT = 8_000;

export interface BashResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Output was cut at `BASH_OUTPUT_LIMIT` characters. */
  truncated: boolean;
  /** Killed after `BASH_TIMEOUT_SECONDS` (exit 124/137). */
  timedOut: boolean;
  durationMs: number;
}

export function capOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= BASH_OUTPUT_LIMIT) return { text, truncated: false };
  return {
    text: `${text.slice(0, BASH_OUTPUT_LIMIT)}\n… [output truncated]`,
    truncated: true,
  };
}

/**
 * Runs one command in the sandbox with coreutils `timeout`. A non-zero exit
 * is a result, not an error; only infrastructure failures throw (→ retry).
 */
export async function runBash(command: string): Promise<BashResult> {
  const sandbox = await getAdminSandbox();
  const started = Date.now();
  const result = await sandbox.runCommand({
    cmd: "timeout",
    args: [
      "--kill-after=5s",
      `${String(BASH_TIMEOUT_SECONDS)}s`,
      "bash",
      "-lc",
      command,
    ],
  });
  const stdout = capOutput(await result.stdout());
  const stderr = capOutput(await result.stderr());
  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut: result.exitCode === 124 || result.exitCode === 137,
    durationMs: Date.now() - started,
  };
}
