import type { InferUITools, UIMessage } from "ai";

import type { shoppingTools } from "./tools";

/**
 * Message type of the shopping chat, shared by the client and the server.
 * Tool parts are typed from the tool definitions (type-only import, so no
 * server code reaches the client bundle). No custom metadata or data parts.
 */
export type ShoppingUIMessage = UIMessage<
  never,
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- intentionally no custom data parts; keeps the part union closed for exhaustive switches
  Record<never, never>,
  InferUITools<typeof shoppingTools>
>;

export type ShoppingMessagePart = ShoppingUIMessage["parts"][number];
