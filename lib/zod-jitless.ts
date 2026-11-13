import { z } from "zod";

/**
 * zod 4 probes `new Function` once (when the first object schema is built) to
 * decide on its JIT. The CSP has no 'unsafe-eval', so the caught probe still
 * logs a `securitypolicyviolation`. `jitless` skips the probe.
 *
 * Side-effect module: import it before anything that imports `ai` or `zod`,
 * because `ai` builds its schemas at import time.
 */
z.config({ jitless: true });
