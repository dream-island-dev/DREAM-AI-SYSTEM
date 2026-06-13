// supabase/functions/get-wa-templates/index.ts
// Fetches WhatsApp templates from Meta WABA API.
//
// Query params:
//   ?all=true   — returns ALL statuses (APPROVED, PENDING, REJECTED) for template manager
//   (default)   — returns only APPROVED templates for broadcast UI
//
// Env (Supabase secrets):
//   META_WHATSAPP_TOKEN       — Meta Cloud API bearer token
//   META_BUSINESS_ACCOUNT_ID  — WhatsApp Business Account (WABA) ID
//
// Returns: { ok: true, templates: [{ name, language, status, bodyText, varCount, category }] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetaComponent {
  type:    string;
  text?:   string;
  format?: string;
}

interface MetaTemplate {
  id:         string;
  name:       string;
  language:   string;
  status:     string;
  category:   string;
  components: MetaComponent[];
  rejected_reason?: string;
}

function countVars(bodyText: string): number {
  const nums = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length > 0 ? Math.max(...nums) : 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token  = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID");

    // Startup diagnostics — visible in Supabase → Edge Functions → Logs
    console.log("[get-wa-templates] token present:", !!token, "| wabaId:", wabaId ?? "MISSING");

    if (!token)  throw new Error("missing_secret: META_WHATSAPP_TOKEN");
    if (!wabaId) throw new Error("missing_secret: META_BUSINESS_ACCOUNT_ID");

    const url_obj = new URL(req.url);
    let fetchAll = url_obj.searchParams.get("all") === "true";
    // Also accept all:true in request body (for Supabase invoke which can't set query params easily)
    if (!fetchAll && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        fetchAll = body?.all === true;
      } catch { /* no body — keep false */ }
    }

    // When all=true fetch all statuses; otherwise only APPROVED
    const statusFilter = fetchAll ? "" : "&status=APPROVED";
    const url =
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
      `?limit=50${statusFilter}&fields=id,name,language,status,category,components,rejected_reason`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      // Log raw Meta error so it appears in Supabase Edge Function logs
      console.error(`[get-wa-templates] Meta API ${res.status} for WABA ${wabaId}:`, detail);
      throw new Error(`meta_api_${res.status}: ${detail}`);
    }

    const json = await res.json() as { data?: MetaTemplate[] };

    const templates = (json.data ?? []).map((t) => {
      const bodyComp   = t.components.find((c) => c.type === "BODY");
      const headerComp = t.components.find((c) => c.type === "HEADER");
      const footerComp = t.components.find((c) => c.type === "FOOTER");
      const bodyText   = bodyComp?.text ?? "";
      return {
        id:              t.id,
        name:            t.name,
        language:        t.language,
        status:          t.status,
        category:        t.category ?? "MARKETING",
        bodyText,
        headerText:      headerComp?.text ?? null,
        footerText:      footerComp?.text ?? null,
        varCount:        countVars(bodyText),
        rejectedReason:  t.rejected_reason ?? null,
      };
    });

    return new Response(
      JSON.stringify({ ok: true, templates }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
