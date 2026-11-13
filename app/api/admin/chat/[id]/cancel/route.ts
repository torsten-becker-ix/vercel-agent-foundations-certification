import { isAdminRequest, unauthorized } from "@/lib/admin-request";
import { cancelChatRun } from "@/lib/chat-route";

/** Cancels an admin chat run (admins only; see `cancelChatRun`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminRequest())) return unauthorized();
  const { id } = await params;
  return cancelChatRun(request, id, "adminChatFlow");
}
