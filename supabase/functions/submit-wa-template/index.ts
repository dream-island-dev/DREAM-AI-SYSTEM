/**
 * submit-wa-template
 * ─────────────────────────────────────────────────────────────────
 * מקבל הגדרת תבנית → שולח ל-Meta לאישור → שומר ב-message_templates.
 *
 * Body (JSON):
 *   name      string  — snake_case, e.g. "dream_summer_promo"
 *   category  string  — "MARKETING" | "UTILITY"
 *   body      string  — טקסט גוף התבנית, תומך ב-{{1}} {{2}}
 *   header    string? — כותרת אופציונלית
 *   footer    string? — footer אופציונלי (ברירת מחדל: Dream Island footer)
 *   language  string? — ברירת מחדל "he"
 *
 * Deploy:
 *   npx supabase functions deploy submit-wa-template --no-verify-jwt
 * ─────────────────────────────────────────────────────────────────
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function maxVar(text: string): number {
  const nums = new Set<number>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return nums.size === 0 ? 0 : Math.max(...nums);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      name, category = "MARKETING", body, header,
      footer = "Dream Island Resort | 08-6705600",
      language = "he",
    } = await req.json();

    if (!name?.trim() || !body?.trim()) {
      return json({ ok: false, error: "name and body are required" }, 400);
    }

    const TOKEN   = Deno.env.get("WHATSAPP_TOKEN");
    const WABA_ID = Deno.env.get("WHATSAPP_WABA_ID") ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!TOKEN || !WABA_ID) {
      return json({ ok: false, error: "WHATSAPP_TOKEN / WHATSAPP_WABA_ID not configured" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Build Meta payload ────────────────────────────────────────────────────
    const mv       = maxVar(body);
    const examples = Array.from({ length: mv }, (_, i) => i === 0 ? "אורח יקר" : "ערך לדוגמה");

    const components: unknown[] = [];
    if (header?.trim()) {
      components.push({ type: "HEADER", format: "TEXT", text: header.trim() });
    }
    components.push({
      type: "BODY",
      text: body.trim(),
      ...(mv > 0 ? { example: { body_text: [examples] } } : {}),
    });
    if (footer?.trim()) {
      components.push({ type: "FOOTER", text: footer.trim() });
    }

    const metaPayload = { name: name.trim(), category, language, components };

    // ── Submit to Meta ────────────────────────────────────────────────────────
    const metaRes  = await fetch(
      `https://graph.facebook.com/v19.0/${WABA_ID}/message_templates`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body:    JSON.stringify(metaPayload),
      },
    );
    const metaData = await metaRes.json();
    const metaOk   = metaRes.ok && metaData.id;

    // ── Save to Supabase (upsert — retries allowed) ───────────────────────────
    await supabase.from("message_templates").upsert({
      name:         name.trim(),
      category,
      language,
      body:         body.trim(),
      header:       header?.trim() ?? null,
      footer:       footer?.trim() ?? null,
      meta_status:  metaOk ? "pending_approval" : "rejected",
      meta_id:      metaData.id ?? null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: "name" });

    if (metaOk) {
      return json({ ok: true, meta_id: metaData.id, status: metaData.status ?? "PENDING" });
    }

    return json({ ok: false, error: metaData.error?.message ?? "Meta error" });

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
