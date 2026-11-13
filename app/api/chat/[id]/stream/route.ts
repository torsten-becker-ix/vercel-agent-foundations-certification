import { resumeChatRun } from "@/lib/chat-route";

/** Reconnects to a shopping chat run (see `resumeChatRun`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return resumeChatRun(request, id, "shoppingChatFlow");
}
