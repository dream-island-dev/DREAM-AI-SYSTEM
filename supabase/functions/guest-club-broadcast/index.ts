// supabase/functions/guest-club-broadcast/index.ts
// Staff broadcast to active Dream Island club members only (consent = Zero-Spam).
//
// POST {
//   channel: "whapi" | "meta_template",
//   message?: string,              // required for whapi — supports {{GUEST_NAME}}
//   waTemplateName?: string,       // required for meta_template
//   templateVariables?: string[],  // optional; {{1}} defaults to guest name
//   dry_run?: boolean,             // count + sample only, no sends
//   limit?: number,                // max recipients this request (default 60, max 80)
// }
//
// Whapi: free-text via Suites device token (no Meta template fee).
// Meta: reuses whatsapp-send trigger=broadcast with target_channel=meta.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText, cleanPhoneForMention } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMIT = 60;
const HARD_MAX = 80;

type MemberRow = {
  id: string;
  phone: string;
  guest_id: number | null;
  guests: { name: string | null } | { name: string | null }[] | null;
};

function guestNameFrom(row: MemberRow): string {
  const g = row.guests;
  if (Array.isArray(g)) return String(g[0]?.name ?? "").trim() || "אורח יקר";
  return String(g?.name ?? "").trim() || "אורח יקר";
}

function personalize(message: string, name: string): string {
  return String(message ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name)
    .replace(/\{\{\s*1\s*\}\}/g, name)
    .trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as {
      channel?: string;
      message?: string;
      waTemplateName?: string;
      templateVariables?: string[];
      dry_run?: boolean;
      limit?: number;
    };

    const channel = String(body.channel ?? "whapi").trim().toLowerCase();
    if (channel !== "whapi" && channel !== "meta_template") {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_channel" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const dryRun = body.dry_run === true;
    const limit = Math.min(
      HARD_MAX,
      Math.max(1, Number(body.limit) || DEFAULT_LIMIT),
    );

    const message = String(body.message ?? "").trim();
    const waTemplateName = String(body.waTemplateName ?? "").trim();

    if (channel === "whapi" && !message && !dryRun) {
      return new Response(
        JSON.stringify({ ok: false, error: "message_required" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (channel === "meta_template" && !waTemplateName && !dryRun) {
      return new Response(
        JSON.stringify({ ok: false, error: "waTemplateName_required" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: members, error: memErr } = await supabase
      .from("guest_club_members")
      .select("id, phone, guest_id, guests(name)")
      .eq("status", "active")
      .order("opted_in_at", { ascending: false })
      .limit(limit);
    if (memErr) throw new Error(`club_members_fetch: ${memErr.message}`);

    const rows = (members ?? []) as MemberRow[];
    const sample = rows.slice(0, 3).map((r) => ({
      phone: r.phone,
      name: guestNameFrom(r),
      preview: channel === "whapi" ? personalize(message, guestNameFrom(r)).slice(0, 120) : waTemplateName,
    }));

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          channel,
          eligible: rows.length,
          limit,
          sample,
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const results: Array<{ phone: string; name: string; status: string; error?: string }> = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const phone = String(row.phone ?? "").trim();
      const name = guestNameFrom(row);
      if (!phone) {
        skipped++;
        results.push({ phone: "", name, status: "skipped_no_phone" });
        continue;
      }

      try {
        if (channel === "whapi") {
          const text = personalize(message, name);
          if (!text) {
            skipped++;
            results.push({ phone, name, status: "skipped_empty_body" });
            continue;
          }
          const wamid = await sendWhapiText(cleanPhoneForMention(phone), text);
          await supabase.from("notification_log").insert({
            guest_id: row.guest_id,
            recipient: phone,
            trigger_type: "club_broadcast",
            channel: "whatsapp",
            status: "sent",
            payload: { channel: "whapi", wamid, source: "guest_club" },
          });
          await supabase.from("whatsapp_conversations").insert({
            phone,
            guest_id: row.guest_id,
            direction: "outbound",
            message: `[WHAPI] ${text}`,
            wa_message_id: wamid,
            inbox_channel: "whapi",
            channel: "whapi",
            intent: "club_broadcast",
          });
          sent++;
          results.push({ phone, name, status: "sent" });
        } else {
          // Meta approved template via existing whatsapp-send broadcast path.
          const vars = Array.isArray(body.templateVariables) && body.templateVariables.length > 0
            ? body.templateVariables.map((v) => String(v ?? "").replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name))
            : [name];
          const payload: Record<string, unknown> = {
            trigger: "broadcast",
            waTemplateName,
            templateVariables: vars,
            target_channel: "meta",
            force: true,
          };
          if (row.guest_id) payload.guestId = row.guest_id;
          else payload.phone = phone;

          const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(55000),
          });
          const json = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (!res.ok || json.ok === false) {
            const err = String(json.error ?? json.status ?? `http_${res.status}`);
            failed++;
            results.push({ phone, name, status: "failed", error: err });
            continue;
          }
          if (json.skipped) {
            skipped++;
            results.push({ phone, name, status: String(json.reason ?? "skipped") });
            continue;
          }
          sent++;
          results.push({ phone, name, status: String(json.status ?? "sent") });
        }
      } catch (e) {
        failed++;
        results.push({ phone, name, status: "failed", error: (e as Error).message });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        channel,
        eligible: rows.length,
        sent,
        failed,
        skipped,
        results,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-club-broadcast] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
