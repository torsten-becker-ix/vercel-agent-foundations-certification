// Typed environment variables (dot access under `noPropertyAccessFromIndexSignature`).
// Names only — values live in `.env.local` / Vercel project settings. See `.env.example`.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Store API base URL. Server-only. */
    readonly API_BASE_URL?: string;
    /** Vercel deployment-protection bypass for the store API. Server-only — never expose. */
    readonly BYPASS_SECRET?: string;
    /** Public site URL for metadata. */
    readonly NEXT_PUBLIC_SITE_URL?: string;
  }
}
