import { CheckIcon, ClockIcon, TerminalIcon, XIcon } from "lucide-react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

/**
 * One `bash` call in the admin chat: the command, then running / output /
 * failure. States are spelled out in text (not only color or a spinner), and
 * the output blocks are focusable so they scroll with the keyboard.
 */
export function BashOutput({
  command,
  state,
  result,
  errorText,
}: {
  command: string | undefined;
  state: "running" | "done" | "error" | "stopped";
  result?:
    | {
        exitCode: number;
        stdout: string;
        stderr: string;
        truncated: boolean;
        timedOut: boolean;
        durationMs: number;
      }
    | undefined;
  errorText?: string | undefined;
}) {
  const failed =
    state === "error" ||
    (result !== undefined && (result.exitCode !== 0 || result.timedOut));

  return (
    <figure
      aria-label="Sandbox command"
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-muted/40 p-2 text-xs",
        failed && "border-destructive/40",
      )}
    >
      <figcaption className="flex items-start gap-1.5 font-mono">
        <TerminalIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <code className="break-all whitespace-pre-wrap">{command ?? "…"}</code>
      </figcaption>

      {state === "running" ? (
        <p>
          <Shimmer as="span" duration={1.5}>
            Running in the sandbox…
          </Shimmer>
        </p>
      ) : null}

      {state === "stopped" ? (
        <p className="text-muted-foreground">Stopped.</p>
      ) : null}

      {state === "error" ? (
        <p className="flex items-center gap-1.5 text-destructive">
          <XIcon aria-hidden="true" className="size-3.5" />
          The command couldn&apos;t run
          {errorText === undefined ? "." : `: ${errorText}`}
        </p>
      ) : null}

      {result === undefined ? null : (
        <>
          {result.stdout === "" ? null : (
            <pre
              aria-label="Command output"
              className="max-h-64 overflow-auto rounded bg-background p-2 font-mono whitespace-pre-wrap"
              // Scrollable region: focusable so keyboard users can scroll it.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable output must be keyboard-reachable (WCAG 2.1.1)
              tabIndex={0}
            >
              {result.stdout}
            </pre>
          )}
          {result.stderr === "" ? null : (
            <pre
              aria-label="Error output"
              className="max-h-40 overflow-auto rounded bg-background p-2 font-mono whitespace-pre-wrap text-destructive"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable output must be keyboard-reachable (WCAG 2.1.1)
              tabIndex={0}
            >
              {result.stderr}
            </pre>
          )}
          <p
            className={cn(
              "flex items-center gap-1.5",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {result.timedOut ? (
              <ClockIcon aria-hidden="true" className="size-3.5" />
            ) : failed ? (
              <XIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            )}
            {result.timedOut
              ? "Timed out after 30 s."
              : failed
                ? `Failed with exit code ${String(result.exitCode)}.`
                : "Finished (exit code 0)."}{" "}
            {(result.durationMs / 1000).toFixed(1)} s
            {result.truncated ? " · output truncated" : ""}
          </p>
        </>
      )}
    </figure>
  );
}
