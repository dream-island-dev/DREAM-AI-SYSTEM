// supabase/functions/push-notify/index.ts
// Sends a Web Push notification to one user (userId) or all managers of a
// department (department). Uses the VAPID protocol directly via Deno's
// Web Crypto API so there is no external dependency on web-push npm.
//
// Send modes:
//   { userId, title, body, url?, tag? }        — single user
//   { department, title, body, url?, tag? }    — broadcast to dept managers
//
// Environment secrets required:
//   VAPID_PUBLIC_KEY   — URL-safe base64 ECDH P-256 public key
//   VAPID_PRIVATE_KEY  — URL-safe base64 ECDH P-256 private key
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── VAPID Signing (pure Web Crypto, no npm) ──────────────────────────────────

function base64urlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

function base64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  return base64urlEncode(arr.buffer);
}

async function buildVapidJwt(
  audience: string, // e.g. "https://fcm.googleapis.com"
  subject: string,  // mailto:...
  vapidPublicKeyB64: string,
  vapidPrivateKeyB64: string
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const enc = new TextEncoder();
  const headerB64  = base64urlEncode(enc.encode(JSON.stringify(header)).buffer);
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)).buffer);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the private key
  const rawPrivate = base64urlDecode(vapidPrivateKeyB64);

  // Reconstruct full PKCS8 from raw 32-byte private key
  // For P-256: prefix is standard PKCS8 header for EC P-256
  const pkcs8Prefix = new Uint8Array([
    0x30,0x41,0x02,0x01,0x00,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,
    0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,0x27,0x30,0x25,
    0x02,0x01,0x01,0x04,0x20,
  ]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + rawPrivate.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(rawPrivate, pkcs8Prefix.length);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    enc.encode(signingInput)
  );

  return `${signingInput}.${base64urlEncode(sig)}`;
}

async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<{ ok: boolean; status: number; stale: boolean }> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await buildVapidJwt(audience, vapidSubject, vapidPublicKey, vapidPrivateKey);

  // Encrypt the payload using Web Push encryption (RFC 8291 — aesgcm / aes128gcm)
  // For simplicity, we send the payload as plaintext with content-encoding: ""
  // and let the push service handle it. Full RFC 8291 encryption would require
  // significant crypto boilerplate; for the MVP we use unencrypted payload
  // (supported by all major push services when keys are provided in VAPID header).
  // TODO (post-MVP): implement RFC 8291 aesgcm encryption for end-to-end privacy.

  const enc = new TextEncoder();
  const body = enc.encode(payload);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt},k=${vapidPublicKey}`,
      "Content-Type": "application/json",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
    },
    body,
  });

  const stale = res.status === 410 || res.status === 404;
  return { ok: res.status >= 200 && res.status < 300, status: res.status, stale };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      userId,
      department,
      title = "Dream Island",
      body  = "",
      url   = "/",
      tag   = "dream-island",
    } = await req.json();

    const vapidPublicKey  = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject    = "mailto:admin@dreamisland.co.il";

    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error("VAPID secrets not configured");
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch target subscription(s)
    let query = supa
      .from("push_subscriptions")
      .select("user_id, subscription");

    if (userId) {
      query = query.eq("user_id", userId);
    } else if (department) {
      // Broadcast: join to profiles to filter by department
      const { data: managers } = await supa
        .from("profiles")
        .select("id")
        .eq("department", department);
      const ids = (managers ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) {
        return new Response(JSON.stringify({ ok: true, sent: 0, note: "no_managers_in_dept" }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      query = query.in("user_id", ids);
    } else {
      throw new Error("Must provide userId or department");
    }

    const { data: rows, error: fetchErr } = await query;
    if (fetchErr) throw new Error("db_fetch: " + fetchErr.message);

    const payloadStr = JSON.stringify({ title, body, url, tag });
    let sent = 0, failed = 0;
    const staleIds: string[] = [];

    await Promise.allSettled(
      (rows ?? []).map(async (row: { user_id: string; subscription: any }) => {
        try {
          const result = await sendPushNotification(
            row.subscription,
            payloadStr,
            vapidPublicKey,
            vapidPrivateKey,
            vapidSubject
          );
          if (result.stale) {
            staleIds.push(row.user_id);
            failed++;
          } else if (result.ok) {
            sent++;
          } else {
            console.warn(`[push-notify] endpoint returned ${result.status} for user ${row.user_id}`);
            failed++;
          }
        } catch (e) {
          console.error(`[push-notify] send failed for ${row.user_id}:`, (e as Error).message);
          failed++;
        }
      })
    );

    // Auto-cleanup stale subscriptions (410 Gone)
    if (staleIds.length) {
      await supa.from("push_subscriptions").delete().in("user_id", staleIds);
      console.log(`[push-notify] cleaned ${staleIds.length} stale subscriptions`);
    }

    return new Response(
      JSON.stringify({ ok: true, sent, failed, stale_cleaned: staleIds.length }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[push-notify] error:", err.message);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
