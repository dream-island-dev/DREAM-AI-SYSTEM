// supabase/functions/automation-history/index.ts
//
// Read-only execution history ("מה נשלח") for the Automation Control Center.
// Projects notification_log (the existing, already-comprehensive send-attempt
// log — every WhatsApp send in this codebase, scheduled or manual, already
// writes here with status sent/simulated/failed/timeout + a payload blob)
// joined with guests(name) and automation_stages(display_name) into a flat,
// human-readable history list. Makes NO writes and sends no messages — pure
// projection, same convention as automation-queue/index.ts.
//
// Returns:
//   { ok: true, history: [{ id, guestName, recipient, triggerType,
//       stageDisplayName, scheduledFor, actualSentAt, status, channel, error }] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ISRAEL_UTC_OFFSET_HOURS = 2;

// Friendly labels for ad-hoc triggers that have no automation_stages row
// (those stages are timeline-driven; these are manual/one-off sends).
const ADHOC_LABELS: Record<string, string> = {
  broadcast: "📣 שידור הודעות (ידני)",
  payment_and_workshops: "💳 תשלום + סדנאות (ידני)",
  inbox_reply: "💬 מענה תיבת הודעות (ידני)",
  shift_assignment: "📅 סידור משמרות",
};

interface StageRow {
  stage_key: string;
  display_name: string;
  schedule_mode: "day_offset_with_time" | "hours_after_event" | "event_immediate";
  anchor_event: "arrival_date" | "departure_date" | "arrival_confirmed_at" | "checkin_time";
  day_offset: number | null;
  local_time: string | null;
  offset_hours: number | null;
}

interface GuestRow {
  id: number | string;
  name: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  checkin_time: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}
function parseLocalTimeToUtcHour(localTime: string): number {
  return parseInt(localTime.split(":")[0], 10) - ISRAEL_UTC_OFFSET_HOURS;
}
function utcHourToTimestamp(dateStr: string, utcHour: number): Date {
  const normalized = ((utcHour % 24) + 24) % 24;
  return new Date(`${dateStr}T${String(normalized).padStart(2, "0")}:00:00.000Z`);
}

// Historical reconstruction of "when this stage was supposed to fire" for a
// row that ALREADY happened. Deliberately duplicated (not imported) from
// _shared/automationSchedule.ts's resolveStageSchedule: that resolver's
// checkEligibility() returns scheduledFor:null once guest_flag_column is
// true — i.e. exactly the "already sent" rows this history view exists to
// show. Re-deriving only the pure date math here (no eligibility gate) is a
// few duplicated lines vs. reshaping a shared Phase-4 dispatcher contract.
function computeScheduledFor(stage: StageRow | undefined, guest: GuestRow | undefined | null): string | null {
  if (!stage) return null;
  if (stage.schedule_mode === "day_offset_with_time") {
    const anchorDateStr = stage.anchor_event === "departure_date" ? guest?.departure_date : guest?.arrival_date;
    if (!anchorDateStr) return null;
    const anchorDate = new Date(`${anchorDateStr}T00:00:00.000Z`);
    const targetDateStr = ymd(addDays(anchorDate, stage.day_offset ?? 0));
    const floorUtcHour = stage.local_time ? parseLocalTimeToUtcHour(stage.local_time) : 0;
    return utcHourToTimestamp(targetDateStr, floorUtcHour).toISOString();
  }
  if (stage.schedule_mode === "hours_after_event") {
    const anchorTs = stage.anchor_event === "checkin_time" ? guest?.checkin_time : null;
    if (!anchorTs) return null;
    return new Date(new Date(anchorTs).getTime() + (stage.offset_hours ?? 0) * 3600 * 1000).toISOString();
  }
  return null; // event_immediate (e.g. stage_2_arrival) — no future instant to predict, it IS the reply
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;

    const { data: logRows, error: logErr } = await supabase
      .from("notification_log")
      .select("id, guest_id, recipient, trigger_type, status, payload, sent_at")
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (logErr) throw new Error(`notification_log_lookup_error: ${logErr.message}`);

    const guestIds = [...new Set((logRows ?? []).map((r) => r.guest_id).filter((id) => id != null))];
    const { data: guestsData, error: guestsErr } = guestIds.length
      ? await supabase.from("guests").select("id, name, arrival_date, departure_date, checkin_time").in("id", guestIds)
      : { data: [] as GuestRow[], error: null };
    if (guestsErr) throw new Error(`guests_lookup_error: ${guestsErr.message}`);
    const guestById = new Map((guestsData ?? []).map((g) => [g.id, g as GuestRow]));

    const { data: stagesData, error: stagesErr } = await supabase
      .from("automation_stages")
      .select("stage_key, display_name, schedule_mode, anchor_event, day_offset, local_time, offset_hours");
    if (stagesErr) throw new Error(`stages_lookup_error: ${stagesErr.message}`);
    const stageByKey = new Map((stagesData ?? []).map((s) => [s.stage_key, s as StageRow]));

    const history = (logRows ?? []).map((row) => {
      const guest = row.guest_id != null ? guestById.get(row.guest_id) : null;
      const stage = stageByKey.get(row.trigger_type);
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        guestName: guest?.name ?? row.recipient ?? null,
        recipient: row.recipient ?? null,
        triggerType: row.trigger_type,
        stageDisplayName: stage?.display_name ?? ADHOC_LABELS[row.trigger_type] ?? row.trigger_type,
        scheduledFor: computeScheduledFor(stage, guest),
        actualSentAt: row.sent_at,
        status: row.status,
        channel: (payload.channel as string | undefined) ?? null,
        error: (payload.error as string | undefined) ?? (payload.sessionMessageFailureNote as string | undefined) ?? null,
      };
    });

    return new Response(
      JSON.stringify({ ok: true, history }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[automation-history] error:", msg);
    // Always HTTP 200 — same convention as every other Edge Function here.
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
