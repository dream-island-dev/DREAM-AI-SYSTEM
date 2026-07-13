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
//     buttons?:  Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string }>
//                — optional, max 3 quick-reply buttons OR up to 2 URL/phone buttons mixed in
//                  per Meta's template limits. Added for the Automation Control Center's
//                  "Convert to Meta Template" action (interactive buttons on session messages
//                  → equivalent BUTTONS component on the approved-template fallback).
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
      buttons?:  Array<{ type: string; text: string; url?: string; phone_number?: string; example?: string }>;
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

    const bodyText = body.body.trim();
    // Meta requires sample values whenever the body contains {{n}} variables.
    const bodyVarMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
    const maxBodyVar = bodyVarMatches.reduce((m, x) => Math.max(m, Number(x[1])), 0);
    const bodyComponent: Record<string, unknown> = { type: "BODY", text: bodyText };
    if (maxBodyVar > 0) {
      const samples = Array.from({ length: maxBodyVar }, (_, i) =>
        i === 0 ? "ישראל ישראלי" : `ערך${i + 1}`,
      );
      bodyComponent.example = { body_text: [samples] };
    }
    components.push(bodyComponent);

    if (body.footer?.trim()) {
      components.push({ type: "FOOTER", text: body.footer.trim() });
    }

    if (body.buttons && body.buttons.length > 0) {
      if (body.buttons.length > 3) {
        throw new Error("עד 3 כפתורים בתבנית (מגבלת Meta)");
      }
      const builtButtons = body.buttons.map((b) => {
        const type = (b.type ?? "QUICK_REPLY").toUpperCase();
        if (!b.text?.trim()) throw new Error("לכל כפתור חייב להיות טקסט");
        if (type === "URL") {
          if (!b.url?.trim()) throw new Error("כפתור מסוג URL חייב לינק");
          const url = b.url.trim();
          const btn: Record<string, unknown> = { type: "URL", text: b.text.trim().slice(0, 25), url };
          // Dynamic URL (…/{{1}}) requires a suffix example for Meta review.
          if (/\{\{\s*1\s*\}\}/.test(url)) {
            const ex = (b as { example?: string }).example?.trim()
              || "00000000-0000-0000-0000-000000000001#survey";
            btn.example = [ex];
          }
          return btn;
        }
        if (type === "PHONE_NUMBER") {
          if (!b.phone_number?.trim()) throw new Error("כפתור מסוג PHONE_NUMBER חייב מספר טלפון");
          return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: b.phone_number.trim() };
        }
        return { type: "QUICK_REPLY", text: b.text.trim() };
      });
      components.push({ type: "BUTTONS", buttons: builtButtons });
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
