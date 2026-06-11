// supabase/functions/get-wa-templates/index.ts
// Fetches approved WhatsApp templates from Meta WABA API and returns a
// simplified list for the BroadcastDashboard UI.
//
// Env (Supabase secrets):
//   META_WHATSAPP_TOKEN       — Meta Cloud API bearer token
//   META_BUSINESS_ACCOUNT_ID  — WhatsApp Business Account (WABA) ID
//
// Returns: { ok: true, templates: [{ name, language, status, bodyText, varCount }] }
// varCount = max {{N}} index found in body text (so {{1}}{{2}} → varCount=2)

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
  name:       string;
  language:   string;
  status:     string;
  components: MetaComponent[];
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

    if (!token)  throw new Error("missing_secret: META_WHATSAPP_TOKEN");
    if (!wabaId) throw new Error("missing_secret: META_BUSINESS_ACCOUNT_ID");

    const url =
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
      `?status=APPROVED&limit=30&fields=name,language,status,components`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      throw new Error(`meta_api_${res.status}: ${detail}`);
    }

    const json = await res.json() as { data?: MetaTemplate[] };

    const templates = (json.data ?? []).map((t) => {
      const bodyComp = t.components.find((c) => c.type === "BODY");
      const bodyText = bodyComp?.text ?? "";
      return {
        name:     t.name,
        language: t.language,
        status:   t.status,
        bodyText,
        varCount: countVars(bodyText),
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
