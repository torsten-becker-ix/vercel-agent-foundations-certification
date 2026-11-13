import { AlertCircleIcon, RotateCcwIcon, WifiOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error notices under the conversation. `role="alert"` announces them, so no
 * separate status message is needed.
 */
export function ChatNotices({
  isError,
  disconnected,
  onReconnect,
  onRetry,
}: {
  isError: boolean;
  disconnected: boolean;
  onReconnect: () => void;
  onRetry: () => void;
}) {
  if (!isError) return null;
  if (disconnected) {
    return (
      <div
        className="flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
        role="alert"
      >
        <p className="flex items-center gap-2">
          <WifiOffIcon aria-hidden="true" className="size-4" />
          Connection lost. The answer continues when you&apos;re back online.
        </p>
        <Button onClick={onReconnect} size="sm" type="button" variant="outline">
          <RotateCcwIcon aria-hidden="true" />
          Reconnect
        </Button>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
      role="alert"
    >
      <p className="flex items-center gap-2 text-destructive">
        <AlertCircleIcon aria-hidden="true" className="size-4" />
        Sorry, something went wrong while answering.
      </p>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        <RotateCcwIcon aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
