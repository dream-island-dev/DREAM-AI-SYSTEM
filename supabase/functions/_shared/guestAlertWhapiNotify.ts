// supabase/functions/_shared/guestAlertWhapiNotify.ts
// Every guest_alerts row (Requests Board) also pings the "בקשות אורחים" Whapi
// group — same JID resolution as inbox-route-request / RoutingControlCenter.
// Best-effort, never blocks the caller (matches triggerInboxRedAlert contract).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "./whapiSend.ts";
import { alertIntentType, resolveRequestsWhapiGroupId } from "./routingConfig.ts";
import { containsHebrew, translateTextForFieldOps } from "./fieldOpsTranslation.ts";
import { triggerInboxRedAlert } from "./inboxRedAlert.ts";

const ALERT_HEADLINE: Record<string, string> = {
  request:              "🛎️ GUEST REQUEST",
  complaint:            "😤 COMPLAINT",
  severe_complaint:     "🚨 SEVERE COMPLAINT",
  date_change_request:  "🗓️ DATE CHANGE",
  upsell_opportunity:   "🌴 PORTAL REQUEST",
  spa_request:          "💆 SPA REQUEST",
  financial_issue:      "💳 FINANCIAL ISSUE",
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
};

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
  extraLine?: string | null;
}): string {
  const headline = ALERT_HEADLINE[opts.alertType] ?? "🛎️ GUEST ALERT";
  const channel = opts.sourceLabel?.trim() ? ` — ${opts.sourceLabel.trim()}` : "";
  const suite = opts.room?.trim() ? `Suite ${opts.room.trim()}` : "Suite —";
  const name = opts.guestName?.trim() || "Guest";
  return [
    `${headline}${channel} | ${suite} (${name})`,
    opts.message.trim(),
    ...(opts.extraLine?.trim() ? [opts.extraLine.trim()] : []),
    "Please check the Requests Board.",
  ].join("\n");
}

/** Whapi group (+ optional personal DM). Returns delivery flags for UI/diagnostics. */
export async function notifyGuestAlertWhapiGroup(
  supabase: SupabaseClient,
  opts: GuestAlertNotifyOpts,
): Promise<{ groupNotified: boolean; personalNotified: boolean }> {
  const intent = alertIntentType(opts.alertType);
  const groupId = (await resolveRequestsWhapiGroupId(supabase, intent)) ?? "";

  const ctx = await resolveGuestContext(supabase, opts.guestId, opts.guestName, opts.room);

  let bodyText = opts.message;
  if (containsHebrew(bodyText)) {
    bodyText = await translateTextForFieldOps(bodyText, {
      room: ctx.room,
      style: "description_only",
    });
  }

  const card = buildGuestAlertWhapiCard({
    alertType: opts.alertType,
    message: bodyText,
    guestName: ctx.guestName,
    room: ctx.room,
    sourceLabel: opts.sourceLabel,
  });

  let groupNotified = false;
  if (groupId) {
    try {
      await sendWhapiText(groupId, card, { noLinkPreview: true });
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
        await sendWhapiText(personalPhone, card, { noLinkPreview: true });
        personalNotified = true;
      } catch (e) {
        console.warn("[guestAlertWhapiNotify] personal DM failed:", (e as Error).message);
      }
    }
  }

  return { groupNotified, personalNotified };
}

/** Red-alert Inbox flag + Whapi requests group — call after every guest_alerts insert. */
export async function onGuestAlertInserted(
  supabase: SupabaseClient,
  opts: GuestAlertNotifyOpts,
): Promise<{ groupNotified: boolean; personalNotified: boolean }> {
  await triggerInboxRedAlert(supabase, {
    guestId:        opts.guestId ?? null,
    phone:          opts.phone,
    conversationId: opts.conversationId ?? null,
    summary:        opts.message.slice(0, 200),
  }).catch((e: Error) =>
    console.warn("[guestAlertWhapiNotify] red-alert failed:", e.message),
  );

  return notifyGuestAlertWhapiGroup(supabase, opts);
}
