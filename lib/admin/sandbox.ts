import "server-only";

import { createHash } from "node:crypto";

import { Sandbox, type SandboxUser } from "@vercel/sandbox";

/**
 * The admin agent's Vercel Sandbox: one **named, persistent** sandbox per
 * environment. Its filesystem is snapshotted when a session stops and comes
 * back on the next call, so it holds both the computation workspace and the
 * memory file across conversations.
 *
 * - `deny-all` network: code in the VM never needs the internet; store data
 *   is fetched by the app (with the API secret) and written in as files.
 * - No secrets in its environment.
 * - Two Linux users: `bash` and the data files belong to **`analyst`**
 *   (`/home/analyst`); the memory file lives in the default user's home
 *   (SDK 3.x: `/vercel`), which `analyst` can read but not write. So a
 *   command (e.g. one injected via ticket text) can't rewrite memory; only
 *   the `saveMemory` tool (app code) can.
 * - Snapshots never expire: when the only snapshot expired, `getOrCreate`
 *   would replace the sandbox with an empty one and memory would be lost.
 *
 * A `Sandbox` handle isn't serializable, so every workflow step gets its own.
 */
export const ADMIN_SANDBOX_NAME = `ship-it-shop-admin-${process.env.VERCEL_ENV ?? "development"}`;

/**
 * One session; a later call resumes a stopped sandbox (~1 s). Short, because
 * a running session is billed: a run takes well under a minute.
 */
const SESSION_TIMEOUT_MS = 3 * 60_000;

const CONFIG = {
  persistent: true,
  networkPolicy: "deny-all",
  resources: { vcpus: 1 },
  timeout: SESSION_TIMEOUT_MS,
  snapshotExpiration: 0,
  keepLastSnapshots: { count: 1, expiration: 0 },
} as const;

export const ANALYST_USER = "analyst";

/** Per function instance: the config is enforced once, the user created once. */
let prepared: Promise<void> | undefined;

async function prepare(sandbox: Sandbox): Promise<void> {
  // `getOrCreate` applies options only when it creates the sandbox; keep an
  // existing one in line with CONFIG (network policy, timeout, snapshots).
  await sandbox.update(CONFIG);
  try {
    await sandbox.createUser(ANALYST_USER);
  } catch (error) {
    if (!(
      error instanceof Error && error.name === "SandboxUserAlreadyExistsError"
    )) {
      throw error;
    }
  }
}

export async function getAdminSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.getOrCreate({
    name: ADMIN_SANDBOX_NAME,
    ...CONFIG,
  });
  prepared ??= prepare(sandbox).catch((error: unknown) => {
    prepared = undefined; // retry on the next call
    throw error;
  });
  await prepared;
  return sandbox;
}

/** The unprivileged user that runs `bash` and owns the data files. */
export async function getAnalyst(): Promise<SandboxUser> {
  return (await getAdminSandbox()).asUser(ANALYST_USER);
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
 * Writes rows as JSON into the analyst's home for `bash` (relative path, so
 * `bash` sees it as `data/<file>`). Errors propagate, so the step retries.
 */
export async function writeDataFile(
  path: string,
  rows: unknown,
): Promise<string> {
  const analyst = await getAnalyst();
  await analyst.writeFiles([
    { path, content: Buffer.from(JSON.stringify(rows, null, 1)) },
  ]);
  return path;
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
  /** Stopped after `BASH_TIMEOUT_SECONDS`. */
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
 * Runs `$AGENT_CMD` with a time limit and caps both streams **inside the VM**
 * (a runaway `yes` can't flood the function's memory), replacing invalid
 * UTF-8 (the SDK can't decode it). The exit code is the command's.
 */
const BASH_WRAPPER = [
  "set -o pipefail",
  `timeout --kill-after=5s ${String(BASH_TIMEOUT_SECONDS)}s bash -lc "$AGENT_CMD" \\`,
  `  2> >(head -c ${String(BASH_OUTPUT_LIMIT + 1)} | iconv -c -f utf-8 -t utf-8 >&2) \\`,
  `  | head -c ${String(BASH_OUTPUT_LIMIT + 1)} | iconv -c -f utf-8 -t utf-8`,
  "code=${PIPESTATUS[0]}",
  "wait",
  'exit "$code"',
].join("\n");

/** True for `timeout`'s exit codes once the limit actually passed. */
export function isTimeout(exitCode: number, durationMs: number): boolean {
  return (
    exitCode === 124 ||
    (exitCode === 137 && durationMs >= BASH_TIMEOUT_SECONDS * 1000)
  );
}

/**
 * Runs one command as the analyst user. A non-zero exit is a result, not an
 * error; only infrastructure failures throw (→ step retry).
 */
export async function runBash(command: string): Promise<BashResult> {
  const analyst = await getAnalyst();
  const started = Date.now();
  const result = await analyst.runCommand({
    cmd: "bash",
    args: ["-c", BASH_WRAPPER],
    env: { AGENT_CMD: command },
  });
  const durationMs = Date.now() - started;
  const stdout = capOutput(await result.stdout());
  const stderr = capOutput(await result.stderr());
  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut: isTimeout(result.exitCode, durationMs),
    durationMs,
  };
}
