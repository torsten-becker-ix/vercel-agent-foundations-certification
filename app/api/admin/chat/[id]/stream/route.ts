import { isAdminRequest, unauthorized } from "@/lib/admin-request";
import { resumeChatRun } from "@/lib/chat-route";

/** Reconnects to an admin chat run (admins only; see `resumeChatRun`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminRequest())) return unauthorized();
  const { id } = await params;
  return resumeChatRun(request, id, "adminChatFlow");
}
