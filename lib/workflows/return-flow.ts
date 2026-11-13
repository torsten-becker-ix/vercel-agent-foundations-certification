import { createWebhook, FatalError, getStepMetadata, sleep } from "workflow";

import {
  ApiRequestError,
  createReturn,
  getOrder,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "../api";
import {
  returnCallbackSchema,
  returnEligibility,
  type ReturnDecided,
  type ReturnOutcome,
  toReturnOutcome,
} from "../returns";

export interface ReturnRequest {
  orderId: string;
  reason: string;
}

/** The API decides 15–60 s after filing; first poll after that window opens. */
const FIRST_POLL_DELAY = "20s";
const POLL_INTERVAL = "15s";
/** About 4 minutes of polling before reporting the return as still pending. */
const MAX_POLLS = 16;

/** API rejections that retrying can't fix become non-retryable. */
function toFatal(error: unknown, action: string): unknown {
  if (
    error instanceof ApiRequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    return new FatalError(
      `${action} was rejected (status ${String(error.status)}).`,
    );
  }
  return error;
}

// ---------------------------------------------------------------------------
// Steps: one side effect each. A completed step is never re-run, so a retry of
// a later step (e.g. filing) doesn't notify the customer or pre-authorize the
// refund a second time.
// ---------------------------------------------------------------------------

async function lookupOrderStep(orderId: string) {
  "use step";
  try {
    const order = await getOrder(orderId);
    const eligibility = returnEligibility(order);
    if (eligibility.status !== "eligible") {
      throw new FatalError(`Order ${orderId} is not eligible for a return.`);
    }
    // Only what the workflow needs; the customer email stays out of the run log.
    return {
      orderId: order.id,
      currency: order.currency,
      items: order.items.map(({ productId, quantity }) => ({
        productId,
        quantity,
      })),
    };
  } catch (error) {
    throw toFatal(error, "Looking up the order");
  }
}

async function notifyCustomerStep(orderId: string) {
  "use step";
  await notifyReturnInProcess(orderId);
}

async function preauthorizeRefundStep(orderId: string) {
  "use step";
  try {
    const authorization = await preauthorizeRefund(orderId);
    return { authorizationId: authorization.id, amount: authorization.amount };
  } catch (error) {
    throw toFatal(error, "Pre-authorizing the refund");
  }
}

async function fileReturnStep(input: {
  orderId: string;
  items: { productId: string; quantity: number }[];
  reason: string;
  callback: string;
}) {
  "use step";
  // Opt-in fault injection to demonstrate reliable side effects: with
  // RETURN_FLOW_FAULT=file-once, the first attempt fails and the step retries,
  // while notification and pre-authorization (earlier steps) don't repeat.
  if (
    process.env.RETURN_FLOW_FAULT === "file-once" &&
    getStepMetadata().attempt === 1
  ) {
    throw new Error("Injected failure (RETURN_FLOW_FAULT=file-once)");
  }
  try {
    const filed = await createReturn({
      ...input,
      callback: publicCallbackUrl(input.callback),
    });
    return { returnId: filed.id };
  } catch (error) {
    throw toFatal(error, "Filing the return");
  }
}

async function getReturnOutcomeStep(returnId: string, currency: string) {
  "use step";
  try {
    return toReturnOutcome(await getReturn(returnId), currency);
  } catch (error) {
    throw toFatal(error, "Reading the return decision");
  }
}

/**
 * `webhook.url` is built from `VERCEL_URL`, the deployment URL, which Vercel
 * Authentication protects (401 for the store API's callback). On production,
 * send the public production domain instead: same path and token, and it
 * serves the same webhook route. Previews keep the deployment URL (protected →
 * the decision arrives by polling).
 */
function publicCallbackUrl(url: string): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || productionHost === undefined) {
    return url;
  }
  const callback = new URL(url);
  callback.protocol = "https:";
  callback.host = productionHost;
  return callback.toString();
}

// eslint-disable-next-line @typescript-eslint/require-await -- stand-in for an async email-provider call (like the starter's notifyReturnInProcess)
async function notifyDecisionStep(outcome: ReturnDecided) {
  "use step";
  // eslint-disable-next-line no-console -- intentional stand-in for the customer email
  console.log(
    `[returnFlow] 📧 told customer: return for order ${outcome.orderId} was ${outcome.decision}`,
  );
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Files a return and waits for the store's decision, without blocking the
 * chat (it runs as its own workflow, started by the `returnOrder` tool).
 *
 * The decision arrives two ways, whichever is first:
 * - Webhook: the API POSTs to `webhook.url`. The URL is a bearer token, so the
 *   request is only a signal; the decision is read from `GET /returns/{id}`.
 * - Polling: fallback when the callback can't reach us (localhost, protected
 *   preview deployments).
 */
export async function returnFlow(
  request: ReturnRequest,
): Promise<ReturnOutcome> {
  "use workflow";

  const order = await lookupOrderStep(request.orderId);
  await notifyCustomerStep(order.orderId);
  await preauthorizeRefundStep(order.orderId);

  using webhook = createWebhook();
  // The endpoint is registered with the next steps, not before them; the API
  // may call back right after filing, so make sure it exists first.
  await webhook.getConflict();
  const { returnId } = await fileReturnStep({
    orderId: order.orderId,
    items: order.items,
    reason: request.reason,
    callback: webhook.url,
  });

  let settled = false;

  const pending: ReturnOutcome = {
    status: "pending",
    orderId: order.orderId,
    returnId,
    currency: order.currency,
  };

  /**
   * One decision lookup. A lookup that fails even after its retries counts as
   * "not decided yet": the return is already filed, so the run must not fail.
   */
  const lookUp = async (): Promise<ReturnOutcome> => {
    try {
      return await getReturnOutcomeStep(returnId, order.currency);
    } catch {
      return pending;
    }
  };

  const viaWebhook = async (): Promise<ReturnOutcome> => {
    for await (const incoming of webhook) {
      const body = returnCallbackSchema.safeParse(
        await incoming.json().catch(() => null),
      );
      if (body.success && body.data.returnId === returnId) {
        const outcome = await lookUp();
        if (outcome.status === "decided") return outcome;
      }
    }
    return pending;
  };

  const viaPolling = async (): Promise<ReturnOutcome> => {
    await sleep(FIRST_POLL_DELAY);
    for (let poll = 0; poll < MAX_POLLS && !settled; poll++) {
      const outcome = await lookUp();
      if (outcome.status === "decided") return outcome;
      await sleep(POLL_INTERVAL);
    }
    // Still undecided: getReturnStatus looks the decision up live later.
    return pending;
  };

  const outcome = await Promise.race([viaWebhook(), viaPolling()]);
  settled = true;

  if (outcome.status === "decided") await notifyDecisionStep(outcome);
  return outcome;
}
