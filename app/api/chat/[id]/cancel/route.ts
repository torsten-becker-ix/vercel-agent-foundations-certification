import { cancelChatRun } from "@/lib/chat-route";

/** Cancels a shopping chat run (Stop / New chat; see `cancelChatRun`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return cancelChatRun(request, id, "shoppingChatFlow");
}
