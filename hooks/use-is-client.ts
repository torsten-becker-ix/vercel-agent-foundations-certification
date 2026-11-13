import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => undefined;

/** False during SSR and hydration, true afterwards (no hydration mismatch). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}
