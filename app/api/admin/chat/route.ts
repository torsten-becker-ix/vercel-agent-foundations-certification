import { isAdminRequest, unauthorized } from "@/lib/admin-request";
import { startChatRun } from "@/lib/chat-route";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

/**
 * Admin chat: one durable run per employee message. Checks the admin cookie
 * itself, because `proxy.ts` only guards the `/admin` pages.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await isAdminRequest())) return unauthorized();
  return startChatRun(request, adminChatFlow);
}
