// Whapi inbound webhook shared-secret gate.
// Configure on the Whapi channel via PATCH /settings → webhooks[].headers:
//   { "X-Whapi-Secret": "<same value as WHAPI_WEBHOOK_SECRET>" }
// https://support.whapi.cloud/help-desk/account/customizable-webhook-headers

import { timingSafeEqualStrings } from "./timingSafeEqual.ts";

export const WHAPI_WEBHOOK_SECRET_HEADER = "x-whapi-secret";

/** Reads the custom header Whapi sends when configured on the channel. */
export function readWhapiWebhookSecretHeader(req: Request): string | null {
  return req.headers.get(WHAPI_WEBHOOK_SECRET_HEADER)
    ?? req.headers.get("X-Whapi-Secret");
}

/** Returns false when secret env or header missing / mismatch. */
export function verifyWhapiWebhookSecret(
  incomingHeader: string | null,
  expectedSecret: string,
): boolean {
  const incoming = String(incomingHeader ?? "").trim();
  const expected = String(expectedSecret ?? "").trim();
  if (!incoming || !expected) return false;
  return timingSafeEqualStrings(incoming, expected);
}

export function isWhapiWebhookAuthBypassed(): boolean {
  return Deno.env.get("WHAPI_WEBHOOK_SKIP_AUTH") === "true";
}

/** Verify only when webhook secret is configured and skip is off. */
export function shouldVerifyWhapiWebhookSecret(): boolean {
  if (isWhapiWebhookAuthBypassed()) return false;
  return !!(Deno.env.get("WHAPI_WEBHOOK_SECRET") ?? "").trim();
}
