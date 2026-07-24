// guest-emergency-broadcast — Meta dream_service_fallback via Dream Bot.
//
// POST {
//   dry_run?: boolean,
//   limit?: number,
//   cohort?: "arrival_today" | "arriving_tomorrow" | "in_resort" | "active",
//   only_missing_meta_window?: boolean
// }
// Audience: suite guests per cohort; always target_channel=meta.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INTER_SEND_DELAY_MS, sleep } from "../_shared/outboundThrottle.ts";
import { SERVICE_FALLBACK_TEMPLATE } from "../_shared/serviceFallbackTemplate.ts";
import {
  type DreamBotCohort,
  filterGuestsForDreamBotCohort,
  israelYmd,
  israelTomorrowYmd,
} from "../_shared/guestDreamBotCohort.ts";
import { primeGuestChannelConfig } from "../_shared/guestWhapiRouting.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMIT = 80;
const HARD_MAX = 120;

const COHORT_LABELS: Record<DreamBotCohort, string> = {
  arrival_today: "הגעות היום",
  arriving_tomorrow: "מגיעים מחר",
  in_resort: "בריזורט עכשיו",
  active: "בריזורט + מגיעים היום/מחר",
};

type GuestRow = {
  id: number;
  name: string | null;
  phone: string | null;
  status: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  wa_window_expires_at: string | null;
  room: string | null;
  room_type: string | null;
};

function parseCohort(raw: unknown): DreamBotCohort {
  const c = String(raw ?? "arrival_today").trim();
  if (c === "arriving_tomorrow" || c === "in_resort" || c === "active") return c;
  return "arrival_today";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({})) as {
      dry_run?: boolean;
      limit?: number;
      cohort?: string;
      only_missing_meta_window?: boolean;
    };
    const dryRun = body.dry_run === true;
    const limit = Math.min(HARD_MAX, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const cohort = parseCohort(body.cohort);
    const onlyMissingWindow = body.only_missing_meta_window === true;
    const today = israelYmd();
    const tomorrow = israelTomorrowYmd();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await primeGuestChannelConfig(supabase);

    const cutoff = (() => {
      const [y, m, d] = today.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 1);
      return dt.toISOString().slice(0, 10);
    })();

    const { data: guests, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, status, arrival_date, departure_date, wa_window_expires_at, room, room_type")
      .or(`arrival_date.gte.${cutoff},departure_date.gte.${cutoff}`)
      .not("status", "in", '("cancelled","checked_out")')
      .not("phone", "is", null)
      .order("arrival_date")
      .order("name")
      .limit(500);
    if (guestErr) throw new Error(`guests_fetch: ${guestErr.message}`);

    const filtered = filterGuestsForDreamBotCohort(
      (guests ?? []) as GuestRow[],
      cohort,
      { onlyMissingMetaWindow: onlyMissingWindow },
    ).slice(0, limit);

    const sample = filtered.slice(0, 8).map((g) => ({
      id: g.id,
      name: String(g.name ?? "").trim() || "אורח יקר",
      phone: g.phone,
      arrival_date: g.arrival_date,
      status: g.status,
    }));

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          template: SERVICE_FALLBACK_TEMPLATE,
          cohort,
          cohort_label: COHORT_LABELS[cohort],
          today,
          tomorrow,
          only_missing_meta_window: onlyMissingWindow,
          eligible: filtered.length,
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

    for (let i = 0; i < filtered.length; i++) {
      const g = filtered[i];
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

      if (i < filtered.length - 1) await sleep(INTER_SEND_DELAY_MS);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        template: SERVICE_FALLBACK_TEMPLATE,
        cohort,
        cohort_label: COHORT_LABELS[cohort],
        today,
        tomorrow,
        only_missing_meta_window: onlyMissingWindow,
        eligible: filtered.length,
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
