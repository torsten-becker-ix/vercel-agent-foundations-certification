# Ship It Shop — Store Agents

Two AI agents for the Vercel **Ship It Shop** storefront, built for the Vercel Agent Foundations certification ("Store Agents"):

- **Shopping agent** — the robot icon on every storefront page. Helps customers find products and return orders. Product search results and details render as cards; returns need an Approve/Deny confirmation and then run as their own durable workflow.
- **Store admin agent** — at `/admin` (demo login). Helps employees investigate support, returns, inventory and sales. Back-office data is fetched on the server, computed with a `bash` tool in a persistent **Vercel Sandbox**, and useful context is kept in a memory file in that sandbox.

Both agents use the **AI SDK** (`WorkflowAgent`), run every model and tool call as a **Vercel Workflow** step, and stream into **AI Elements** chat UIs. The storefront itself (products, search, cart) is the starter's and is unchanged in behavior.

## Stack

| | |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript (strictest settings) |
| AI | AI SDK 7 (`ai`, `@ai-sdk/react`), `@ai-sdk/workflow` (`WorkflowAgent`, `WorkflowChatTransport`), AI Gateway, model `openai/gpt-oss-120b` |
| Durability | Vercel Workflow (`workflow`) |
| Sandbox | Vercel Sandbox (`@vercel/sandbox`) |
| UI | Tailwind CSS v4, shadcn/ui, AI Elements |
| Tests | Vitest (126 tests), ESLint (type-aware, 0 warnings), Prettier |

## Setup

Prerequisites: Node.js 22+, pnpm, the Vercel CLI, and a Vercel project created from the assignment's Deploy link (it sets `BYPASS_SECRET`).

```bash
git clone <this repo>
cd vercel-agent-foundations-certification
pnpm install
vercel link                    # link to your Vercel project
vercel env pull .env.local     # BYPASS_SECRET, VERCEL_OIDC_TOKEN (AI Gateway + Sandbox auth)
```

Then create `.env.development.local` (not overwritten by `vercel env pull`) with the approval secret:

```bash
echo "TOOL_APPROVAL_SECRET=$(openssl rand -base64 48)" >> .env.development.local
pnpm dev                       # http://localhost:3000
```

- Admin agent: open `/admin` and sign in with the demo password from the assignment.
- `VERCEL_OIDC_TOKEN` expires after 12 hours locally; run `vercel env pull .env.local` again.
- Deploying: add `TOOL_APPROVAL_SECRET` to the Vercel project (Production + Preview, *Sensitive*). On Vercel, the AI Gateway and the Sandbox authenticate with the deployment's OIDC token automatically.

## Environment variables

No values are committed; `.env.example` is the template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Store API protection bypass. Sent only as the `x-vercel-protection-bypass` header, server-side. |
| `API_BASE_URL` | No | Store API base URL (defaults to the Vercel Swag Store API). |
| `VERCEL_OIDC_TOKEN` | Locally | Auth for the AI Gateway and Vercel Sandbox, written by `vercel env pull`. Automatic on Vercel. |
| `AI_GATEWAY_API_KEY` | No | Alternative Gateway auth for local development (put it in `.env.development.local`). |
| `TOOL_APPROVAL_SECRET` | Yes (returns) | HMAC key that signs return approvals, so an approval can't be forged by editing the chat history. ≥ 32 random bytes. |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for metadata, robots and sitemap. Defaults to the Vercel production domain, else localhost. |
| `RETURN_FLOW_FAULT` | No, dev only | `file-once` makes the return workflow's filing step fail once, to demonstrate that completed steps aren't repeated. Never set on Vercel. |

## Scripts

| Command | |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm check` | Format check, lint (0 warnings), typecheck, tests |
| `pnpm test` | Vitest |
| `pnpm exec workflow inspect runs` | Local workflow runs (`-b vercel` for production) |

## Architecture

```
Browser (useChat + WorkflowChatTransport, chat persisted in localStorage)
  │ POST /api/chat            POST /api/admin/chat (checks the admin cookie)
  │ GET  …/[id]/stream        (resume)        POST …/[id]/cancel (Stop)
  ▼
Workflow run — one per message
  shoppingChatFlow                       adminChatFlow
  WorkflowAgent + shopping tools         read memory (step) → WorkflowAgent + admin tools
  │                                      │
  ├─ searchProducts, getProductDetails,  ├─ getSupportTickets, getReturnsHistory,
  │  getAllCategories (store API)        │  getInventoryStock, getSalesAnalytics
  ├─ returnOrder (needs approval) ──┐    │  (store API → PII removed → JSON file in the sandbox)
  └─ getReturnStatus                │    ├─ bash ─────────► Vercel Sandbox (persistent, deny-all,
                                    ▼    │                  user "analyst")
               returnFlow (own workflow) └─ saveMemory ──► memory/MEMORY.md (same sandbox)
               lookup → notify → pre-authorize → file
               → decision via webhook (or polling) → notify
```

### Project structure (agent code)

```
app/api/chat/route.ts                 shopping chat (start run)
app/api/chat/[id]/stream|cancel/      resume / cancel a shopping run
app/api/admin/chat/…                  same for the admin chat, cookie-checked
lib/agent.ts, lib/tools.ts            shopping agent config, tools, return tools
lib/workflows/chat-flow.ts            shopping chat workflow
lib/workflows/return-flow.ts          return workflow (steps, webhook, polling)
lib/workflows/admin-chat-flow.ts      admin chat workflow (memory, step guards)
lib/workflows/chat-stream.ts          shared: failure/close steps, streamWithRecovery
lib/admin/                            admin agent: config, tools, sandbox, memory, message type
lib/chat-route.ts                     shared route logic (start, resume, cancel)
lib/chat-storage.ts, persistent-chat.ts, hooks/use-persistent-chat.ts   refresh + reconnect
lib/request-guard.ts, admin-request.ts   JSON/origin/size guard, admin cookie check
components/agent-chat.tsx, shopping/  shopping chat UI + generative UI (cards, approval)
components/admin-agent-chat.tsx, admin/   admin chat UI (tool status, bash output)
components/chat/                      shared chat pieces
```

## Implementation decisions

**`WorkflowAgent`, one run per message.** The workshop's `DurableAgent` is `WorkflowAgent` in the current `@ai-sdk/workflow`. Each user message starts one workflow run, so every model call and tool call is a checkpointed, retried step. Expected outcomes (no results, unknown category, order not found) are returned as tool results; transient store API errors are re-thrown so the step retries; other rejections become `FatalError`.

**Stream recovery.** `WorkflowChatTransport` reconnects to the same run via `GET /api/chat/[id]/stream?startIndex=N`. The durable stream stores raw model parts while `startIndex` counts UI chunks, so the route replays the raw stream from 0 and lets `createModelCallToUIChunkTransform({ uiStartIndex })` skip what the client has. After a page refresh, the chat restores the messages *as sent* from `localStorage` and resumes the stored run, which rebuilds the in-flight answer exactly once: no duplicate output, no second run. After a lost connection, the `online` event remounts the session the same way. Stop and "New chat" cancel the run.

**Returns.** `returnOrder` has a `needsApproval` function that checks eligibility first, so impossible returns never show an approval card. Approvals are HMAC-signed. After Approve, the next run starts `returnFlow` as its own workflow (the chat isn't blocked): lookup → customer notification → refund pre-authorization → filing → decision → notification, one side effect per step, so a retried filing never repeats the notification or pre-authorization. The start is idempotent per order (a Workflow hook token), so a replayed approval can't file twice. The decision arrives through a `createWebhook()` callback (sent with the production domain, because deployment URLs are protected) and is always re-read from the API; polling is the fallback (local, previews).

**Admin data and computation.** Back-office tools fetch on the server (the API secret never leaves it), keep an allowlist of fields (no customer emails, no webhook URLs), write all rows as JSON into the sandbox and give the model a summary plus the file path with an example row. The model computes aggregates and joins with `bash` (python3) instead of doing arithmetic, e.g. return rate = returned units / units sold. The sandbox has no network access and no secrets; output is capped and time-limited.

**Memory.** One named, persistent sandbox per environment holds the computation workspace and `memory/MEMORY.md`. The workflow reads the file at the start of every run (app code) and adds it to the instructions; the agent appends with `saveMemory` (idempotent, one line per note). `bash` runs as a separate Linux user that can read but not write the memory file, so injected instructions in ticket text can't rewrite it. Store figures are never stored, only preferences, corrections and business context.

**Model quirks.** gpt-oss-120b was chosen because the free Gateway credits cover it. Every model-specific workaround is tagged `gpt-oss workaround:` in the code (`grep -rn "gpt-oss workaround" lib components app`): provider routing, prompt rules, a calendar computed in app code, step guards, and `streamWithRecovery`, which continues a run when a provider can't parse a tool call and nudges once when a turn ends without an answer.

**Security.** Static CSP and security headers, chat APIs accept same-origin JSON only (size-capped), the admin API checks the admin cookie itself (the proxy only guards the pages), resume/cancel routes only accept runs of their own workflow, model Markdown renders without raw HTML.

## Known limitations

- Admin auth is the starter's demo gate (cookie value = password).
- Any visitor can return any demo order; there are no customer accounts.
- Free-tier Gateway credits are rate-limited; bursts can fail with 429 (the SDK retries).
- gpt-oss occasionally needs several `bash` attempts for one analysis, or answers less completely than asked.
- Each turn re-sends the whole conversation (1 MB / 100 messages cap): very long admin chats need "New chat".
- Preview deployments are protected, so return decisions arrive by polling there.

`CLAUDE.md` has the detailed conventions, strictness rules and gotchas for working on this repo.
