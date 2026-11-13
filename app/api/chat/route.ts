import { startChatRun } from "@/lib/chat-route";
import { shoppingChatFlow } from "@/lib/workflows/chat-flow";

/** Shopping chat: one durable run per shopper message (public route). */
export async function POST(request: Request): Promise<Response> {
  return startChatRun(request, shoppingChatFlow);
}
