import "server-only";

import { getAdminSandbox } from "./sandbox";

/**
 * Admin memory: a Markdown file in the admin sandbox, one dated bullet per
 * note. App code reads it at the start of every run (`readMemory`) and puts
 * it into the instructions; the agent adds to it with the `saveMemory` tool.
 * It lives in the default user's home: `bash` runs as `analyst`, who can read
 * it but not write it (see `sandbox.ts`).
 */
export const MEMORY_FILE = "memory/MEMORY.md";
export const MEMORY_NOTE_MAX = 300;
/** Cap for what goes into the instructions (the newest notes are kept). */
export const MEMORY_PROMPT_MAX = 4_000;

/** One line, collapsed whitespace: a note can't inject Markdown structure. */
export function normalizeNote(note: string): string {
  return note.replace(/\s+/g, " ").trim();
}

function noteText(line: string): string {
  return normalizeNote(line.replace(/^-\s*(?:\d{4}-\d{2}-\d{2}:\s*)?/, ""));
}

/**
 * Appends `note` as `- YYYY-MM-DD: note`, unless the same note (ignoring case
 * and whitespace) is already there. Idempotent, so a retried step doesn't
 * save it twice.
 */
export function appendNote(
  current: string | null,
  note: string,
  date: Date,
): { content: string; added: boolean } {
  const text = normalizeNote(note);
  const existing = (current ?? "").split("\n").filter((line) => line !== "");
  const duplicate = existing.some(
    (line) => noteText(line).toLowerCase() === text.toLowerCase(),
  );
  if (duplicate) return { content: current ?? "", added: false };
  const day = date.toISOString().slice(0, 10);
  return {
    content: `${[...existing, `- ${day}: ${text}`].join("\n")}\n`,
    added: true,
  };
}

/** The newest notes that fit `MEMORY_PROMPT_MAX` characters. */
export function memoryForPrompt(memory: string | null): string | null {
  if (memory === null || memory.trim() === "") return null;
  if (memory.length <= MEMORY_PROMPT_MAX) return memory.trim();
  const lines = memory.trim().split("\n");
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.toReversed()) {
    if (size + line.length + 1 > MEMORY_PROMPT_MAX) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return kept.join("\n");
}

/**
 * The memory file's content, or null when there is no file yet. Sandbox
 * errors propagate, so the step retries instead of silently starting the
 * conversation without the saved context.
 */
export async function readMemory(): Promise<string | null> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_FILE });
  return buffer?.toString("utf8") ?? null;
}

export async function saveNote(
  note: string,
): Promise<{ saved: true } | { saved: false; reason: "duplicate" }> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_FILE });
  const { content, added } = appendNote(
    buffer?.toString("utf8") ?? null,
    note,
    new Date(),
  );
  if (!added) return { saved: false, reason: "duplicate" };
  await sandbox.mkDir("memory").catch(() => undefined);
  await sandbox.writeFiles([
    { path: MEMORY_FILE, content: Buffer.from(content) },
  ]);
  return { saved: true };
}
