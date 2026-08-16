/**
 * ezgo-webhook — Staging sink for EZGO API push.
 * Phase 1: store raw JSON payloads; map to guests after schema is known.
 *
 * Auth (any one is sufficient):
 *   - x-api-key: <EZGO_WEBHOOK_API_KEY>
 *   - Authorization: Bearer <EZGO_WEBHOOK_API_KEY>
 *   - source IP in EZGO_WEBHOOK_ALLOWED_IPS (comma-separated) — EZGO's own webhook
 *     settings screen has no custom-header field, so their pushes never carry the
 *     key; IP allowlisting is the fallback auth path for that sender.
 *
 * POST body: any JSON (object or array). Non-JSON bodies are wrapped in _raw_text.
 * Returns 200 on success (including duplicate id) so EZGO does not retry forever.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractEzgoWebhookMeta } from "../_shared/ezgoWebhookMeta.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-idempotency-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXPECTED_KEY = Deno.env.get("EZGO_WEBHOOK_API_KEY") ?? "";
const ALLOWED_IPS = (Deno.env.get("EZGO_WEBHOOK_ALLOWED_IPS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0].trim();
  return null;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type AuthResult = { ok: boolean; method: "api_key" | "ip_allowlist" | "none" };

function checkAuthorized(req: Request): AuthResult {
  const apiKey = req.headers.get("x-api-key");
  if (EXPECTED_KEY && apiKey && apiKey === EXPECTED_KEY) {
    return { ok: true, method: "api_key" };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (EXPECTED_KEY && auth.startsWith("Bearer ") && auth.slice(7) === EXPECTED_KEY) {
    return { ok: true, method: "api_key" };
  }
  const ip = getClientIp(req);
  if (ip && ALLOWED_IPS.includes(ip)) {
    return { ok: true, method: "ip_allowlist" };
  }
  return { ok: false, method: "none" };
}

function logAuthFailureDiagnostics(req: Request) {
  const headerNames = [...req.headers.keys()].join(", ");
  console.warn(
    `[ezgo-webhook] auth_failed ip=${getClientIp(req) ?? "unknown"} headers=[${headerNames}] has_x_api_key=${req.headers.has("x-api-key")} has_authorization=${req.headers.has("authorization")}`,
  );
}

function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    const lower = k.toLowerCase();
    if (lower === "x-api-key" || lower === "authorization") continue;
    out[k] = v;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed", allowed: ["POST"] });
  }

  if (!EXPECTED_KEY && ALLOWED_IPS.length === 0) {
    console.error("[ezgo-webhook] no auth method configured (EZGO_WEBHOOK_API_KEY / EZGO_WEBHOOK_ALLOWED_IPS)");
    return jsonResponse(503, { error: "webhook_not_configured" });
  }

  const auth = checkAuthorized(req);
  if (!auth.ok) {
    logAuthFailureDiagnostics(req);
    return jsonResponse(401, { error: "unauthorized" });
  }
  if (auth.method === "ip_allowlist") {
    console.info(`[ezgo-webhook] authorized via ip_allowlist ip=${getClientIp(req)}`);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(503, { error: "server_misconfigured" });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || null;

  const rawText = await req.text();
  if (!rawText.trim()) {
    return jsonResponse(400, { error: "empty_body" });
  }

  let rawPayload: unknown;
  try {
    const trimmed = rawText.trim();
    if (
      contentType.includes("application/json") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("[")
    ) {
      rawPayload = JSON.parse(rawText);
    } else {
      rawPayload = { _raw_text: rawText, _content_type: contentType };
    }
  } catch {
    rawPayload = { _raw_text: rawText, _parse_error: "invalid_json" };
  }

  const { event_type, external_id } = extractEzgoWebhookMeta(rawPayload);
  const dedupeExternalId = external_id ?? idempotencyKey;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const row = {
    raw_payload: rawPayload,
    headers: safeHeaders(req),
    content_type: contentType || null,
    event_type,
    external_id: dedupeExternalId,
    idempotency_key: idempotencyKey,
    status: "staged",
  };

  const { data, error } = await supabase
    .from("ezgo_api_ingest")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505" && dedupeExternalId) {
      const { data: existing } = await supabase
        .from("ezgo_api_ingest")
        .select("id")
        .eq("external_id", dedupeExternalId)
        .maybeSingle();

      console.info(`[ezgo-webhook] duplicate external_id=${dedupeExternalId}`);
      return jsonResponse(200, {
        success: true,
        duplicate: true,
        id: existing?.id ?? null,
      });
    }

    console.error("[ezgo-webhook] insert error:", error.message);
    return jsonResponse(500, { error: "storage_failed", detail: error.message });
  }

  console.info(
    `[ezgo-webhook] stored id=${data.id} event=${event_type ?? "unknown"} external=${dedupeExternalId ?? "none"}`,
  );

  return jsonResponse(200, { success: true, id: data.id });
});
