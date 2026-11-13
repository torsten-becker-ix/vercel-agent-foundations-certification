// Typed environment variables (dot access under `noPropertyAccessFromIndexSignature`).
// Names only — values live in `.env.local` / Vercel project settings. See `.env.example`.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Store API base URL. Server-only. */
    readonly API_BASE_URL?: string;
    /** Vercel deployment-protection bypass for the store API. Server-only — never expose. */
    readonly BYPASS_SECRET?: string;
    /** HMAC secret for signed tool approvals (≥ 32 bytes). Server-only. */
    readonly TOOL_APPROVAL_SECRET?: string;
    /** Dev-only fault injection for the return workflow (`file-once`). */
    readonly RETURN_FLOW_FAULT?: string;
    /** Public site URL for metadata. */
    readonly NEXT_PUBLIC_SITE_URL?: string;
    /** Vercel system var: production domain without protocol (fallback for the site URL). */
    readonly VERCEL_PROJECT_PRODUCTION_URL?: string;
  }
}
