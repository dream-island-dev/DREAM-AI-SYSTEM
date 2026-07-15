// supabase/functions/_shared/arrivalEtaAdirNotify.ts
// Personal Whapi DM to duty manager (Adir) when Tier-0 captures guest ETA.
// Record-Only path stays intact — no group card, no human_requested / ops tasks.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendWhapiText, cleanPhoneForMention } from "./whapiSend.ts";
import { buildStaffAppDeepLink, phoneDigitsForDeepLink } from "./guestAlertWhapiNotify.ts";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";
import { israelYmd } from "./automationSchedule.ts";
import { addDaysYmd } from "./resortPulseStats.ts";

/** Same bare digits as task-action.ts ACTOR_PHONES.Adir — duty manager default. */
export const ADIR_PHONE_DIGITS = "972546294885";

type GuestEtaNotifyRow = {
  name?: string | null;
  room?: string | null;
  room_type?: string | null;
  arrival_date?: string | null;
  status?: string | null;
};

export type ArrivalEtaNotifyChannel = "meta" | "whapi";

export function resolveAdirNotifyPhoneDigits(): string {
  const env = (Deno.env.get("SLA_GUEST_ALERT_PHONE") ?? "").replace(/\D/g, "");
  if (env.startsWith("0")) return "972" + env.slice(1);
  return env || ADIR_PHONE_DIGITS;
}

/** Suite guests arriving today or tomorrow (Israel) — Adir's desk window. */
export function isArrivalEtaNotifyEligible(
  guest: GuestEtaNotifyRow | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!guest?.arrival_date) return false;
  if (guest.status === "cancelled") return false;
  if (!isEffectiveSuiteGuest(guest)) return false;
  const today = israelYmd(now);
  const tomorrow = addDaysYmd(today, 1);
  return guest.arrival_date === today || guest.arrival_date === tomorrow;
}

export function formatArrivalDateLabel(arrivalDateYmd: string, now: Date = new Date()): string {
  const today = israelYmd(now);
  if (arrivalDateYmd === today) return "היום";
  if (arrivalDateYmd === addDaysYmd(today, 1)) return "מחר";
  const [y, m, d] = arrivalDateYmd.split("-");
  return `${d}/${m}/${y}`;
}

export function buildArrivalEtaAdirMessage(opts: {
  guestName?: string | null;
  room?: string | null;
  arrivalDate: string;
  timeHhMm: string;
  previousTime?: string | null;
  guestQuote?: string;
  channel: ArrivalEtaNotifyChannel;
  phone: string;
}): string {
  const channelLabel = opts.channel === "meta" ? "Dream Bot" : "מכשיר סוויטות";
  const isUpdate = !!opts.previousTime?.trim() && opts.previousTime.trim() !== opts.timeHhMm;
  const headline = isUpdate ? "🕐 עודכה שעת הגעה" : "🕐 שעת הגעה חדשה";
  const who = opts.guestName?.trim() || "אורח";
  const room = opts.room?.trim() || "—";
  const dateLabel = formatArrivalDateLabel(opts.arrivalDate);
  const timeLine = isUpdate
    ? `${opts.previousTime} → ${opts.timeHhMm}`
    : opts.timeHhMm;

  const digits = phoneDigitsForDeepLink(opts.phone);
  const lines = [
    headline,
    `${who} | ${room} | ${dateLabel} | ${timeLine}`,
    `מקור: ${channelLabel}`,
  ];
  const quote = opts.guestQuote?.trim().slice(0, 200);
  if (quote) lines.push(`«${quote}»`);
  if (digits) {
    lines.push(`💬 שיחה: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: digits, guestName: opts.guestName })}`);
  }
  lines.push(`📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`);
  return lines.join("\n");
}

export async function notifyAdirArrivalEta(
  supabase: SupabaseClient,
  opts: {
    guest: GuestEtaNotifyRow & { arrival_date: string };
    timeHhMm: string;
    previousTime?: string | null;
    guestQuote?: string;
    channel: ArrivalEtaNotifyChannel;
    phone: string;
    guestId?: number | null;
  },
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!isArrivalEtaNotifyEligible(opts.guest)) {
    return { ok: false, skipped: "ineligible_guest" };
  }
  const prev = opts.previousTime?.trim() || null;
  if (prev && prev === opts.timeHhMm) {
    return { ok: false, skipped: "dedupe_same_time" };
  }

  let guestName = opts.guest.name ?? null;
  let room = opts.guest.room ?? null;
  if (opts.guestId && (!guestName || !room)) {
    const { data } = await supabase
      .from("guests")
      .select("name, room")
      .eq("id", opts.guestId)
      .maybeSingle();
    if (data) {
      guestName = guestName ?? (data as { name: string | null }).name;
      room = room ?? (data as { room: string | null }).room;
    }
  }

  const body = buildArrivalEtaAdirMessage({
    guestName,
    room,
    arrivalDate: opts.guest.arrival_date,
    timeHhMm: opts.timeHhMm,
    previousTime: prev,
    guestQuote: opts.guestQuote,
    channel: opts.channel,
    phone: opts.phone,
  });

  const to = cleanPhoneForMention(resolveAdirNotifyPhoneDigits());
  try {
    await sendWhapiText(to, body);
    console.info(`[arrivalEtaAdirNotify] sent to ${to} channel=${opts.channel} time=${opts.timeHhMm}`);
    return { ok: true };
  } catch (e) {
    const err = (e as Error).message;
    console.error("[arrivalEtaAdirNotify] send failed:", err);
    return { ok: false, error: err };
  }
}
