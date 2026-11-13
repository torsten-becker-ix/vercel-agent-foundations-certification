import type { InferUITools, UIMessage } from "ai";

import type { adminTools } from "./tools";

/** Message type of the admin chat, shared by the client and the server. */
export type AdminUIMessage = UIMessage<
  never,
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- intentionally no custom data parts; keeps the part union closed for exhaustive switches
  Record<never, never>,
  InferUITools<typeof adminTools>
>;

export type AdminMessagePart = AdminUIMessage["parts"][number];
