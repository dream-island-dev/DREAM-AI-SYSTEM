import {
  verifyMetaWebhookSignature,
  isMetaWebhookSignatureBypassed,
  shouldVerifyMetaWebhookSignature,
} from "./metaWebhookSignature.ts";
import {
  verifyWhapiWebhookSecret,
  readWhapiWebhookSecretHeader,
  isWhapiWebhookAuthBypassed,
} from "./whapiWebhookAuth.ts";

const APP_SECRET = "test-meta-app-secret";
const WHAPI_SECRET = "dream-whapi-webhook-secret-2026";

Deno.test("verifyMetaWebhookSignature: valid HMAC passes", async () => {
  const body = '{"entry":[{"id":"123"}]}';
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const ok = await verifyMetaWebhookSignature(body, `sha256=${hex}`, APP_SECRET);
  if (!ok) throw new Error("expected valid signature");
});

Deno.test("verifyMetaWebhookSignature: tampered body fails", async () => {
  const body = '{"entry":[{"id":"123"}]}';
  const ok = await verifyMetaWebhookSignature(body, "sha256=deadbeef", APP_SECRET);
  if (ok) throw new Error("expected invalid signature");
});

Deno.test("verifyMetaWebhookSignature: missing header fails", async () => {
  const ok = await verifyMetaWebhookSignature("{}", null, APP_SECRET);
  if (ok) throw new Error("expected missing header to fail");
});

Deno.test("verifyWhapiWebhookSecret: match passes", () => {
  if (!verifyWhapiWebhookSecret(WHAPI_SECRET, WHAPI_SECRET)) {
    throw new Error("expected match");
  }
});

Deno.test("verifyWhapiWebhookSecret: mismatch fails", () => {
  if (verifyWhapiWebhookSecret("wrong", WHAPI_SECRET)) {
    throw new Error("expected mismatch");
  }
});

Deno.test("readWhapiWebhookSecretHeader: case-insensitive header", () => {
  const req = new Request("https://example.com", {
    headers: { "X-Whapi-Secret": WHAPI_SECRET },
  });
  if (readWhapiWebhookSecretHeader(req) !== WHAPI_SECRET) {
    throw new Error("expected header value");
  }
});

Deno.test("shouldVerifyMetaWebhookSignature: false without app secret", () => {
  const prev = Deno.env.get("META_APP_SECRET");
  const prevSkip = Deno.env.get("META_WEBHOOK_SKIP_SIGNATURE");
  try {
    Deno.env.delete("META_APP_SECRET");
    Deno.env.delete("META_WEBHOOK_SKIP_SIGNATURE");
    if (shouldVerifyMetaWebhookSignature()) throw new Error("expected no verify without secret");
  } finally {
    if (prev) Deno.env.set("META_APP_SECRET", prev);
    else Deno.env.delete("META_APP_SECRET");
    if (prevSkip) Deno.env.set("META_WEBHOOK_SKIP_SIGNATURE", prevSkip);
  }
});

Deno.test("bypass flags default false", () => {
  const prevMeta = Deno.env.get("WHATSAPP_SIMULATION");
  const prevWhapi = Deno.env.get("WHAPI_WEBHOOK_SKIP_AUTH");
  try {
    Deno.env.delete("WHATSAPP_SIMULATION");
    Deno.env.delete("META_WEBHOOK_SKIP_SIGNATURE");
    Deno.env.delete("WHAPI_WEBHOOK_SKIP_AUTH");
    if (isMetaWebhookSignatureBypassed()) throw new Error("meta bypass should be false");
    if (isWhapiWebhookAuthBypassed()) throw new Error("whapi bypass should be false");
  } finally {
    if (prevMeta) Deno.env.set("WHATSAPP_SIMULATION", prevMeta);
    if (prevWhapi) Deno.env.set("WHAPI_WEBHOOK_SKIP_AUTH", prevWhapi);
  }
});
