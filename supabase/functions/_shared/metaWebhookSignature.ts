// Meta WhatsApp Cloud API — POST webhook signature verification.
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification
//
// Required secret: META_APP_SECRET (Facebook App → Settings → Basic → App Secret)
// Header: X-Hub-Signature-256: sha256=<hex>

import { timingSafeEqualStrings } from "./timingSafeEqual.ts";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns false when header missing, malformed, or HMAC mismatch. */
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  const header = String(signatureHeader ?? "").trim();
  if (!header.toLowerCase().startsWith("sha256=")) return false;
  const expectedHex = header.slice("sha256=".length).trim().toLowerCase();
  if (!expectedHex || !appSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = bytesToHex(sig);
  return timingSafeEqualStrings(computedHex, expectedHex);
}

/** Simulation / explicit skip — never verify. */
export function isMetaWebhookSignatureBypassed(): boolean {
  return Deno.env.get("WHATSAPP_SIMULATION") === "true"
    || Deno.env.get("META_WEBHOOK_SKIP_SIGNATURE") === "true";
}

/** Verify only when App Secret is configured and skip is off. */
export function shouldVerifyMetaWebhookSignature(): boolean {
  if (isMetaWebhookSignatureBypassed()) return false;
  return !!(Deno.env.get("META_APP_SECRET") ?? "").trim();
}
