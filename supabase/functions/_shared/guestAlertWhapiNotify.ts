// supabase/functions/_shared/guestAlertWhapiNotify.ts
// Every guest_alerts row (Requests Board) also pings the "בקשות אורחים" Whapi
// group — same JID resolution as inbox-route-request / RoutingControlCenter.
// Best-effort, never blocks the caller (matches triggerInboxRedAlert contract).
// Cards are Hebrew (reception group) with staff deep-links — NOT English field-ops.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "./whapiSend.ts";
import { ARCHITECT_PHONE_DIGITS, normalizeExecutivePhoneDigits } from "./executiveIdentity.ts";
import { alertIntentType, resolveRequestsWhapiGroupId } from "./routingConfig.ts";
import { triggerInboxRedAlert, type InboxAlertChannel } from "./inboxRedAlert.ts";

const STAFF_APP_ORIGIN = "https://dream-ai-system.vercel.app";

/** Aligned with RequestsBoard.js TYPE_META labels. */
export const GUEST_ALERT_TYPE_LABEL_HE: Record<string, string> = {
  request:              "🛎️ בקשת אורח",
  complaint:            "😤 תלונה",
  severe_complaint:     "🚨 תלונה חמורה",
  date_change_request:  "🗓️ שינוי תאריך",
  upsell_opportunity:   "🌴 בקשה מהפורטל",
  portal_room_service:  "🍽️ שירות לחדר (פורטל)",
  spa_request:          "💆 בקשת ספא",
  spa_upsell_accept:      "💆 אישור הצעת ספא",
  financial_issue:      "💳 בעיית חיוב",
  arrival_eta:          "🕐 שעת הגעה",
};

const SOURCE_LABEL_HE: Record<string, string> = {
  Inbox:                    "תיבה",
  "Guest Portal":           "פורטל אורחים",
  "WhatsApp Bot":           "בוט",
  "WhatsApp Bot (Whapi)":   "בוט (מכשיר סוויטות)",
};

export type GuestAlertNotifyOpts = {
  alertType: string;
  message: string;
  phone: string;
  guestId?: number | null;
  guestName?: string | null;
  room?: string | null;
  conversationId?: number | null;
  sourceLabel?: string | null;
  /** Also DM SLA_GUEST_ALERT_PHONE (duty manager). Default false — callers that already ping Adir keep their path. */
  alsoPersonalDm?: boolean;
  /** Informational board rows (e.g. arrival_eta) — no Inbox red-dot / no Whapi group spam. */
  boardOnly?: boolean;
  /** Portal / cohort-aware flows — flag the Suites thread instead of default Meta. */
  preferredInboxChannel?: InboxAlertChannel | null;
};

export function guestAlertTypeLabelHe(alertType: string): string {
  return GUEST_ALERT_TYPE_LABEL_HE[alertType] ?? `⚠ ${alertType || "התראה"}`;
}

export function phoneDigitsForDeepLink(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** Same query shape as src/utils/staffDeepLink.js — login-aware open in XOS. */
export function buildStaffAppDeepLink(opts: {
  page: string;
  phone?: string | null;
  guestName?: string | null;
  threadId?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("page", opts.page);
  const digits = phoneDigitsForDeepLink(opts.phone);
  if (digits) params.set("phone", digits);
  if (opts.guestName?.trim()) params.set("guestName", opts.guestName.trim());
  if (opts.threadId?.trim()) params.set("thread", opts.threadId.trim());
  return `${STAFF_APP_ORIGIN}/?${params.toString()}`;
}

function sourceLabelHe(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return SOURCE_LABEL_HE[t] ?? t;
}

async function resolveGuestContext(
  supabase: SupabaseClient,
  guestId: number | null | undefined,
  guestName?: string | null,
  room?: string | null,
): Promise<{ guestName: string | null; room: string | null }> {
  if (guestName?.trim() || room?.trim()) {
    return { guestName: guestName?.trim() || null, room: room?.trim() || null };
  }
  if (!guestId) return { guestName: null, room: null };
  const { data } = await supabase
    .from("guests")
    .select("name, room")
    .eq("id", guestId)
    .maybeSingle();
  return {
    guestName: (data?.name as string | undefined)?.trim() || null,
    room: (data?.room as string | undefined)?.trim() || null,
  };
}

export function buildGuestAlertWhapiCard(opts: {
  alertType: string;
  message: string;
  guestName?: string | null;
  room?: string | null;
  sourceLabel?: string | null;
  phone?: string | null;
  extraLine?: string | null;
}): string {
  const headline = guestAlertTypeLabelHe(opts.alertType);
  const channel = sourceLabelHe(opts.sourceLabel);
  const header = channel ? `${headline} — ${channel}` : headline;
  const room = opts.room?.trim() || "—";
  const name = opts.guestName?.trim() || "אורח";
  const boardUrl = buildStaffAppDeepLink({ page: "requests_board" });
  const digits = phoneDigitsForDeepLink(opts.phone);
  const lines = [
    header,
    `${room} (${name})`,
    opts.message.trim(),
    ...(opts.extraLine?.trim() ? [opts.extraLine.trim()] : []),
  ];
  if (digits) {
    lines.push(
      `💬 שיחה: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: digits, guestName: opts.guestName })}`,
    );
  }
  lines.push(`📋 לוח בקשות: ${boardUrl}`);
  return lines.join("\n");
}

/** Israeli display: +972501234567 → 0501234567 */
export function formatGuestPhoneForStaffWa(phone: string | null | undefined): string {
  const digits = phoneDigitsForDeepLink(phone);
  if (digits.startsWith("972") && digits.length >= 11) return `0${digits.slice(3)}`;
  return digits || String(phone ?? "").trim();
}

function formatArrivalDateHe(ymd: string | null | undefined): string {
  const raw = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [y, m, d] = raw.split("-");
  return `${d}.${m}.${y}`;
}

/** Owner-only DM — forward-friendly block for spa coordination team. */
export function buildSpaUpsellAcceptOwnerDm(opts: {
  guestName?: string | null;
  phone: string;
  room?: string | null;
  arrivalDate?: string | null;
  guestReply: string;
}): string {
  const name = opts.guestName?.trim() || "אורח";
  const room = opts.room?.trim() || "בילוי יומי";
  const arrivalHe = formatArrivalDateHe(opts.arrivalDate);
  const phoneDisplay = formatGuestPhoneForStaffWa(opts.phone);
  const reply = opts.guestReply.trim() || "אישור";
  const inboxUrl = buildStaffAppDeepLink({
    page: "wa_inbox",
    phone: opts.phone,
    guestName: opts.guestName,
  });

  return [
    "💆 אישור הצעת ספא — בילוי יומי",
    `הגעה: ${arrivalHe}`,
    "",
    `${name} · ${phoneDisplay} · ${room}`,
    `«${reply}»`,
    "",
    "── להעברה לצוות הספא ──",
    name,
    phoneDisplay,
    `${room} · הגעה ${arrivalHe}`,
    "מעוניין/ת בטיפול ספא (300₪/45 דק׳) — לתאם שעה",
    "",
    `💬 שיחה: ${inboxUrl}`,
  ].join("\n");
}

/** SPA_UPSELL_NOTIFY_PHONE override; default = architect (Mike) only — not Adir/group SLA. */
export function resolveSpaUpsellNotifyPhone(): string {
  const raw = (Deno.env.get("SPA_UPSELL_NOTIFY_PHONE") ?? "").trim();
  if (raw) {
    const normalized = normalizeExecutivePhoneDigits(raw);
    if (normalized) return normalized;
  }
  return ARCHITECT_PHONE_DIGITS;
}

/** Personal Whapi DM when a day-pass guest accepts spa upsell (owner forwards to spa team). */
export async function notifySpaUpsellAcceptOwnerDm(
  _supabase: SupabaseClient,
  opts: {
    guestName?: string | null;
    phone: string;
    room?: string | null;
    arrivalDate?: string | null;
    guestReply: string;
  },
): Promise<boolean> {
  const target = resolveSpaUpsellNotifyPhone();
  const body = buildSpaUpsellAcceptOwnerDm(opts);
  try {
    await sendWhapiText(target, body);
    return true;
  } catch (e) {
    console.warn("[guestAlertWhapiNotify] spa upsell owner DM failed:", (e as Error).message);
    return false;
  }
}

/** Whapi group (+ optional personal DM). Returns delivery flags for UI/diagnostics. */
export async function notifyGuestAlertWhapiGroup(
  supabase: SupabaseClient,
  opts: GuestAlertNotifyOpts,
): Promise<{ groupNotified: boolean; personalNotified: boolean }> {
  const intent = alertIntentType(opts.alertType);
  const groupId = (await resolveRequestsWhapiGroupId(supabase, intent)) ?? "";

  const ctx = await resolveGuestContext(supabase, opts.guestId, opts.guestName, opts.room);

  // Keep message as stored (usually Hebrew). Do NOT translate HE→EN —
  // this group is Hebrew reception, not English field ops.
  const card = buildGuestAlertWhapiCard({
    alertType: opts.alertType,
    message: opts.message,
    guestName: ctx.guestName,
    room: ctx.room,
    sourceLabel: opts.sourceLabel,
    phone: opts.phone,
  });

  let groupNotified = false;
  if (groupId) {
    try {
      // Link preview on so chat/board URLs are tappable in WhatsApp.
      await sendWhapiText(groupId, card);
      groupNotified = true;
    } catch (e) {
      console.error(`[guestAlertWhapiNotify] group send failed (${intent}):`, (e as Error).message);
    }
  } else {
    console.warn(`[guestAlertWhapiNotify] no requests Whapi group configured (intent=${intent})`);
  }

  let personalNotified = false;
  if (opts.alsoPersonalDm) {
    const personalPhone = (Deno.env.get("SLA_GUEST_ALERT_PHONE") ?? "").trim();
    if (personalPhone) {
      try {
        await sendWhapiText(personalPhone, card);
        personalNotified = true;
      } catch (e) {
        console.warn("[guestAlertWhapiNotify] personal DM failed:", (e as Error).message);
      }
    }
  }

  return { groupNotified, personalNotified };
}

/** Red-alert Inbox flag + Whapi requests group — call after every guest_alerts insert.
 *  Pass `boardOnly: true` for informational types (arrival_eta) that stay on the board only. */
export async function onGuestAlertInserted(
  supabase: SupabaseClient,
  opts: GuestAlertNotifyOpts,
): Promise<{ groupNotified: boolean; personalNotified: boolean }> {
  if (opts.boardOnly) {
    return { groupNotified: false, personalNotified: false };
  }

  await triggerInboxRedAlert(supabase, {
    guestId:        opts.guestId ?? null,
    phone:          opts.phone,
    conversationId: opts.conversationId ?? null,
    summary:        opts.message.slice(0, 200),
    preferredInboxChannel: opts.preferredInboxChannel ?? null,
  }).catch((e: Error) =>
    console.warn("[guestAlertWhapiNotify] red-alert failed:", e.message),
  );

  return notifyGuestAlertWhapiGroup(supabase, opts);
}
