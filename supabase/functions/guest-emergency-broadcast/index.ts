// guest-emergency-broadcast — Meta template to today's arrivals when Whapi is down.
//
// POST { dry_run?: boolean, limit?: number }
// Always dream_service_fallback via Dream Bot (target_channel=meta).
// Audience: arrival_date = today (Israel), not cancelled/checked_out, has phone.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INTER_SEND_DELAY_MS, sleep } from "../_shared/outboundThrottle.ts";
import { SERVICE_FALLBACK_TEMPLATE } from "../_shared/serviceFallbackTemplate.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMIT = 60;
const HARD_MAX = 80;

function israelYmd(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

type GuestRow = { id: number; name: string | null; phone: string | null; status: string | null };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; limit?: number };
    const dryRun = body.dry_run === true;
    const limit = Math.min(HARD_MAX, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const today = israelYmd();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: guests, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, status")
      .eq("arrival_date", today)
      .not("status", "in", '("cancelled","checked_out")')
      .not("phone", "is", null)
      .order("name")
      .limit(limit);
    if (guestErr) throw new Error(`guests_fetch: ${guestErr.message}`);

    const rows = (guests ?? []) as GuestRow[];
    const sample = rows.slice(0, 5).map((g) => ({
      id: g.id,
      name: String(g.name ?? "").trim() || "אורח יקר",
      phone: g.phone,
    }));

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          template: SERVICE_FALLBACK_TEMPLATE,
          arrival_date: today,
          eligible: rows.length,
          limit,
          sample,
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const results: Array<{ guestId: number; name: string; phone: string; status: string; error?: string }> = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const g = rows[i];
      const phone = String(g.phone ?? "").trim();
      const name = String(g.name ?? "").trim() || "אורח יקר";
      if (!phone) {
        skipped++;
        results.push({ guestId: g.id, name, phone: "", status: "skipped_no_phone" });
        continue;
      }

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trigger: "broadcast",
            guestId: g.id,
            waTemplateName: SERVICE_FALLBACK_TEMPLATE,
            templateVariables: [name],
            target_channel: "meta",
            force: true,
          }),
          signal: AbortSignal.timeout(55_000),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (!res.ok || json.ok === false) {
          failed++;
          results.push({
            guestId: g.id, name, phone, status: "failed",
            error: String(json.error ?? json.status ?? `http_${res.status}`),
          });
        } else if (json.skipped) {
          skipped++;
          results.push({ guestId: g.id, name, phone, status: String(json.reason ?? "skipped") });
        } else {
          sent++;
          results.push({ guestId: g.id, name, phone, status: String(json.status ?? "sent") });
        }
      } catch (e) {
        failed++;
        results.push({ guestId: g.id, name, phone, status: "failed", error: (e as Error).message });
      }

      if (i < rows.length - 1) await sleep(INTER_SEND_DELAY_MS);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        template: SERVICE_FALLBACK_TEMPLATE,
        arrival_date: today,
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
    console.error("[guest-emergency-broadcast] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
