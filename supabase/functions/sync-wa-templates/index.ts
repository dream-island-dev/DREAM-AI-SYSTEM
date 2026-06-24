// supabase/functions/sync-wa-templates/index.ts
// Fetches APPROVED WhatsApp templates from Meta Graph API and upserts them
// into the message_templates Supabase table (label, content, sort_order).
//
// POST (no body required) — invoke from BroadcastDashboard "🔄 סנכרן מ-Meta" button.
//
// Env: META_WHATSAPP_TOKEN, META_BUSINESS_ACCOUNT_ID

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Hebrew labels for known templates ────────────────────────────────────────
const LABEL_MAP: Record<string, string> = {
  dream_availability_offer:    "הצעת זמינות",
  dream_followup_no_response:  "מעקב ללא תגובה",
  dream_last_minute:           "הצעה ברגע האחרון",
  dream_seasonal_offer:        "הצעה עונתית",
  dream_spa_package:           "חבילת ספא",
  dream_special_occasion:      "אירוע מיוחד",
  dream_suite_upsell:          "שדרוג לסוויטה",
  dream_wine_experience:       "חוויית יין",
  dream_arrival_confirmation:  "אישור הגעה",
  dream_payment_and_workshops: "תשלום וסדנאות",
  dream_checkin_reminder_v2:   "תזכורת צ'ק-אין",
  dream_welcome_morning:       "בוקר טוב — יום הגעה",
  dream_room_ready:            "חדר מוכן — מסירת מפתח",
  dream_mid_stay_check:        "מעקב אמצע שהות",
  dream_workshop_reminder:     "תזכורת סדנה",
  dream_handover_agent_v2:     "העברה לנציג",
  dream_checkout_feedback:     "פידבק אחרי יציאה",
  hello_world:                 "בדיקת מערכת",
};

// Guest-journey sort order
const SORT_MAP: Record<string, number> = {
  dream_availability_offer:    1,
  dream_followup_no_response:  2,
  dream_last_minute:           3,
  dream_seasonal_offer:        4,
  dream_spa_package:           5,
  dream_special_occasion:      6,
  dream_suite_upsell:          7,
  dream_wine_experience:       8,
  dream_arrival_confirmation:  10,
  dream_payment_and_workshops: 11,
  dream_checkin_reminder_v2:   12,
  dream_welcome_morning:       13,
  dream_room_ready:            13,
  dream_mid_stay_check:        14,
  dream_workshop_reminder:     15,
  dream_handover_agent_v2:     16,
  dream_checkout_feedback:     17,
  hello_world:                 99,
};

const WORKSHOP_LINKS: Record<string, string> = {
  dream_payment_and_workshops: "https://go.oncehub.com/DreamIsland",
  dream_workshop_reminder:     "https://go.oncehub.com/DreamIsland",
};

function snakeToLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface MetaComponent { type: string; text?: string; }
interface MetaTemplate  {
  name: string; status: string; category: string; language: string;
  components: MetaComponent[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token  = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID");
    console.log("[sync-wa-templates] token:", !!token, "| wabaId:", wabaId ?? "MISSING");

    if (!token)  return json({ ok: false, error: "missing_secret: META_WHATSAPP_TOKEN" }, 500);
    if (!wabaId) return json({ ok: false, error: "missing_secret: META_BUSINESS_ACCOUNT_ID" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Fetch all APPROVED templates from Meta ────────────────────────────────
    const res  = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
      `?status=APPROVED&fields=name,status,category,language,components&limit=100`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    const metaData = await res.json();

    if (!res.ok) {
      console.error("[sync-wa-templates] Meta error:", metaData);
      return json({ ok: false, error: metaData.error?.message ?? `meta_api_${res.status}` }, 502);
    }

    const templates = (metaData.data ?? []) as MetaTemplate[];
    let synced = 0, errors = 0;
    const upserted: string[] = [];

    for (const tpl of templates) {
      const bodyText    = tpl.components.find(c => c.type === "BODY")?.text ?? "";
      const label       = LABEL_MAP[tpl.name] ?? snakeToLabel(tpl.name);
      const sortOrder   = SORT_MAP[tpl.name] ?? 50;
      const workshopLink = WORKSHOP_LINKS[tpl.name] ?? null;

      // Update if exists, insert if not — avoids needing a unique constraint
      const { count, error: updErr } = await supabase
        .from("message_templates")
        .update({ label, content: bodyText, sort_order: sortOrder, workshop_link: workshopLink })
        .eq("wa_template_name", tpl.name)
        .select("id", { count: "exact", head: true });

      if (updErr) {
        console.error("[sync-wa-templates] update error:", tpl.name, updErr);
        errors++;
        continue;
      }

      if ((count ?? 0) === 0) {
        const { error: insErr } = await supabase.from("message_templates").insert({
          wa_template_name: tpl.name,
          label,
          content:          bodyText,
          sort_order:       sortOrder,
          workshop_link:    workshopLink,
        });
        if (insErr) {
          console.error("[sync-wa-templates] insert error:", tpl.name, insErr);
          errors++;
          continue;
        }
      }

      synced++;
      upserted.push(tpl.name);
    }

    console.log(`[sync-wa-templates] done: ${synced} synced, ${errors} errors`);
    return json({ ok: true, total: templates.length, synced, errors, upserted });

  } catch (e) {
    console.error("[sync-wa-templates] unexpected:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
