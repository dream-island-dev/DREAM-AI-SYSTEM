// supabase/functions/get-wa-templates/index.ts
// Fetches WhatsApp templates from Meta WABA API.
//
// Query params:
//   ?all=true   — returns ALL statuses (APPROVED, PENDING, REJECTED) for template manager
//   (default)   — returns only APPROVED templates for broadcast/inbox UI
//
// Env (Supabase secrets):
//   META_WHATSAPP_TOKEN       — Meta Cloud API bearer token
//   META_BUSINESS_ACCOUNT_ID  — WhatsApp Business Account (WABA) ID
//
// Returns: { ok: true, templates: [{ name, language, status, bodyText, varCount, category }] }
//
// IMPORTANT — why we do NOT use ?status=APPROVED in the Meta URL:
//   Meta's server-side status filter has documented quirks. Newly-approved templates
//   or templates whose internal status representation differs (e.g. a fresh approval
//   not yet propagated) can silently fail the filter and be omitted from the response.
//   We always fetch ALL statuses from Meta and apply our own status filter after
//   collecting all pages — same result, fully reliable.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetaButton {
  type:         string;
  text?:        string;
  url?:         string;
  phone_number?: string;
}

interface MetaComponent {
  type:    string;
  text?:   string;
  format?: string;
  buttons?: MetaButton[];
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

interface MetaPagedResponse {
  data?:   MetaTemplate[];
  paging?: { next?: string };
}

function countVars(bodyText: string): number {
  const nums = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length > 0 ? Math.max(...nums) : 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token  = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    // WABA ID — try META_BUSINESS_ACCOUNT_ID first, fall back to META_PHONE_NUMBER_ID
    const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID")
                ?? Deno.env.get("META_PHONE_NUMBER_ID")
                ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    // Startup diagnostics — visible in Supabase → Edge Functions → Logs
    console.log("[get-wa-templates] token:", !!token, "| wabaId:", wabaId ?? "MISSING");

    if (!token)  throw new Error("missing_secret: META_WHATSAPP_TOKEN not configured");
    if (!wabaId) throw new Error("missing_secret: META_BUSINESS_ACCOUNT_ID not configured");

    const url_obj = new URL(req.url);
    let fetchAll = url_obj.searchParams.get("all") === "true";
    // Also accept all:true in request body (for Supabase invoke which can't set query params easily)
    if (!fetchAll && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        fetchAll = body?.all === true;
      } catch { /* no body — keep false */ }
    }

    // Fetch ALL templates from Meta without a status filter in the URL.
    // Using ?status=APPROVED here has proven unreliable (newly-approved templates
    // can be omitted). We apply status filtering ourselves after collecting all pages.
    // limit=100 is the maximum Meta allows per page; we still follow paging.next
    // as a safety net in case Meta decides to paginate below our requested limit.
    const baseUrl =
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
      `?limit=100&fields=id,name,language,status,category,components,rejected_reason`;

    const fetchHeaders = { Authorization: `Bearer ${token}` };

    // Collect all template pages (safety cap: 10 pages = up to 1000 templates)
    const allRaw: MetaTemplate[] = [];
    let nextUrl: string | null = baseUrl;
    let pageCount = 0;

    while (nextUrl && pageCount < 10) {
      const res = await fetch(nextUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        console.error(`[get-wa-templates] Meta API ${res.status} for WABA ${wabaId}:`, detail);
        throw new Error(`meta_api_${res.status}: ${detail}`);
      }

      const json = await res.json() as MetaPagedResponse;
      allRaw.push(...(json.data ?? []));
      nextUrl = json.paging?.next ?? null;
      pageCount++;
    }

    console.log(`[get-wa-templates] fetched ${allRaw.length} raw template(s) across ${pageCount} page(s) | fetchAll=${fetchAll}`);

    const templates = allRaw.map((t) => {
      const bodyComp    = t.components.find((c) => c.type === "BODY");
      const headerComp  = t.components.find((c) => c.type === "HEADER");
      const footerComp  = t.components.find((c) => c.type === "FOOTER");
      const buttonsComp = t.components.find((c) => c.type === "BUTTONS");
      const bodyText    = bodyComp?.text ?? "";
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
        // Previously silently dropped — the Automation Control Center's
        // Template Manager needs to display buttons that already exist on a
        // template (e.g. dream_arrival_confirmation's Quick Replies, which
        // were configured by hand in Meta Business Manager, outside this repo).
        buttons: (buttonsComp?.buttons ?? []).map((b) => ({
          type: b.type, text: b.text ?? "", url: b.url ?? null, phoneNumber: b.phone_number ?? null,
        })),
      };
    });

    // For the default (non-all) case, return only APPROVED templates.
    // The client already applies a second filter for defense-in-depth.
    const result = fetchAll
      ? templates
      : templates.filter((t) => String(t.status).toUpperCase() === "APPROVED");

    return new Response(
      JSON.stringify({ ok: true, templates: result }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[get-wa-templates] error:", msg);
    // Return 200 so the frontend can read data?.error instead of getting a generic "non-2xx" message
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
