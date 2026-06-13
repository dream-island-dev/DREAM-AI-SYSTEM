// supabase/functions/create-wa-template/index.ts
// Submits a new WhatsApp message template to Meta for review/approval.
//
// POST body:
//   {
//     name:      string   — snake_case, no spaces, max 512 chars
//     language:  string   — "he" | "en_US" etc. (default: "he")
//     category:  string   — "MARKETING" | "UTILITY" | "AUTHENTICATION" (default: "MARKETING")
//     body:      string   — template body text, use {{1}} {{2}} for variables
//     header?:   string   — optional header text (TEXT type)
//     footer?:   string   — optional footer text
//   }
//
// Returns: { ok: true, template: { id, status } } on success
//
// Env: META_WHATSAPP_TOKEN, META_BUSINESS_ACCOUNT_ID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token  = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID");

    if (!token)  throw new Error("missing_secret: META_WHATSAPP_TOKEN");
    if (!wabaId) throw new Error("missing_secret: META_BUSINESS_ACCOUNT_ID");

    const body = await req.json() as {
      name:      string;
      language?: string;
      category?: string;
      body:      string;
      header?:   string;
      footer?:   string;
    };

    // Validate required fields
    if (!body.name?.trim())  throw new Error("שדה 'name' חסר");
    if (!body.body?.trim())  throw new Error("שדה 'body' (גוף ההודעה) חסר");

    // Validate name format — Meta requires: lowercase, digits, underscores only
    const cleanName = body.name.trim().toLowerCase().replace(/\s+/g, "_");
    if (!/^[a-z0-9_]{1,512}$/.test(cleanName)) {
      throw new Error("שם התבנית יכול להכיל רק אותיות לועזיות קטנות, ספרות וקו תחתון (_)");
    }

    const language = body.language ?? "he";
    const category = (body.category ?? "MARKETING").toUpperCase();

    if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
      throw new Error("קטגוריה לא חוקית — השתמש ב-MARKETING, UTILITY, או AUTHENTICATION");
    }

    // Build components array
    const components: Record<string, unknown>[] = [];

    if (body.header?.trim()) {
      components.push({ type: "HEADER", format: "TEXT", text: body.header.trim() });
    }

    components.push({ type: "BODY", text: body.body.trim() });

    if (body.footer?.trim()) {
      components.push({ type: "FOOTER", text: body.footer.trim() });
    }

    const payload = {
      name:       cleanName,
      language,
      category,
      components,
    };

    const res = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body:   JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      }
    );

    const json = await res.json() as Record<string, unknown>;

    if (!res.ok || json.error) {
      const errMsg = (json.error as Record<string, unknown>)?.message
        ?? (json.error as string)
        ?? `meta_api_${res.status}`;
      throw new Error(String(errMsg));
    }

    return new Response(
      JSON.stringify({ ok: true, template: { id: json.id, status: json.status ?? "PENDING" } }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
