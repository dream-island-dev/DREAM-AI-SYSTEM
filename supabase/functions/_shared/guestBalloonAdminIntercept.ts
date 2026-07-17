// supabase/functions/_shared/guestBalloonAdminIntercept.ts
// Tier-0 balloon décor + administrative in-house intercepts — Meta + Whapi parity.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAdministrativeDispatchReply,
  buildAdministrativeRequestSummary,
  buildBalloonRoomRequestReply,
} from "./automationSchedule.ts";
import { onGuestAlertInserted } from "./guestAlertWhapiNotify.ts";
import { sendWhapiText } from "./whapiSend.ts";

const BALLOON_VENDOR_PHONE = (Deno.env.get("BALLOON_VENDOR_PHONE") ?? "").trim();

export type GuestTier0InboundAdapter = {
  patchInbound: (patch: Record<string, unknown>) => Promise<void>;
  sendReply: (replyText: string, intent: string) => Promise<void>;
  sourceLabel: string;
  logTag: string;
};

export async function logAdministrativeRequestAlert(
  supabase: SupabaseClient,
  args: {
    phone: string;
    guestId: number;
    room: string | null;
    summary: string;
    rawText: string;
    conversationId?: number | null;
    alertType?: string;
    guestName?: string | null;
    sourceLabel?: string;
  },
): Promise<void> {
  const alertType = args.alertType ?? "request";
  const message = args.rawText?.trim() || args.summary;
  const { error: insertErr } = await supabase.from("guest_alerts").insert({
    guest_id: args.guestId,
    phone: args.phone,
    alert_type: alertType,
    message,
    conversation_id: args.conversationId ?? null,
    resolved: false,
  });
  if (insertErr) {
    console.error(`[${args.sourceLabel ?? "guestTier0"}] admin request alert insert error:`, insertErr.message);
    return;
  }
  onGuestAlertInserted(supabase, {
    guestId: args.guestId,
    phone: args.phone,
    conversationId: args.conversationId ?? null,
    message,
    alertType,
    guestName: args.guestName ?? null,
    room: args.room,
    sourceLabel: args.sourceLabel ?? "WhatsApp Bot",
  }).catch((e: Error) =>
    console.warn(`[${args.sourceLabel ?? "guestTier0"}] admin request notify failed:`, e.message),
  );
}

export async function runBalloonRoomRequestIntercept(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    guestId: number;
    guest: Record<string, unknown>;
    text: string;
    conversationId: number | null;
    sim?: boolean;
  },
  adapter: GuestTier0InboundAdapter,
): Promise<void> {
  const { phone, guestId, guest, text, conversationId, sim = false } = opts;
  const guestName = (guest.name as string | null) ?? null;
  const guestRoom = (guest.room as string | null) ?? null;
  const reply = buildBalloonRoomRequestReply(guestName);

  await adapter.patchInbound({
    guest_id: guestId,
    intent: "balloon_room_request",
  });

  const { error: alertErr } = await supabase.from("guest_alerts").insert({
    guest_id: guestId,
    phone,
    alert_type: "request",
    message: `🎈 בקשת בלונים לחדר${guestRoom ? ` (${guestRoom})` : ""}: ${text}`,
    conversation_id: conversationId,
    resolved: false,
  });
  if (alertErr) {
    console.error(`[${adapter.logTag}] balloon guest_alerts insert FAILED:`, alertErr.message);
    return;
  }

  onGuestAlertInserted(supabase, {
    guestId,
    phone,
    conversationId,
    message: `🎈 בקשת בלונים לחדר${guestRoom ? ` (${guestRoom})` : ""}: ${text}`,
    alertType: "request",
    guestName,
    room: guestRoom,
    sourceLabel: adapter.sourceLabel,
  }).catch((e: Error) => console.warn(`[${adapter.logTag}] balloon staff notify failed:`, e.message));

  if (BALLOON_VENDOR_PHONE) {
    sendWhapiText(
      BALLOON_VENDOR_PHONE,
      `🎈 בקשת בלונים לחדר\nסוויטה: ${guestRoom ?? "—"}\nאורח: ${guestName ?? "—"}\n${text}\n\n(הועבר מ-DREAM BOT — צוות הקבלה ישלים פרטים)`,
      { noLinkPreview: true },
    ).catch((e: Error) =>
      console.warn(`[${adapter.logTag}] balloon vendor Whapi alert failed:`, e.message),
    );
  }

  if (!sim) {
    try {
      await adapter.sendReply(reply, "balloon_room_request");
    } catch (e) {
      console.error(`[${adapter.logTag}] balloon intercept reply failed:`, (e as Error).message);
    }
  }

  console.info(
    `[${adapter.logTag}] balloon room request — dispatch=requests_board phone:${phone} guest:${guestId} room:${guestRoom ?? "—"}`,
  );
}

export async function runAdministrativeInHouseIntercept(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    guestId: number;
    guest: Record<string, unknown>;
    text: string;
    conversationId: number | null;
    sim?: boolean;
  },
  adapter: GuestTier0InboundAdapter,
): Promise<void> {
  const { phone, guestId, guest, text, conversationId, sim = false } = opts;
  const summary = buildAdministrativeRequestSummary(text);
  const guestName = (guest.name as string | null) ?? null;
  const guestRoom = (guest.room as string | null) ?? null;
  const reply = buildAdministrativeDispatchReply(guestName);

  await adapter.patchInbound({
    guest_id: guestId,
    intent: "administrative_in_house_request",
  });

  const { error: guestErr } = await supabase.from("guests").update({
    requires_attention: true,
    requires_attention_since: new Date().toISOString(),
    attention_reason: "request",
  }).eq("id", guestId);
  if (guestErr) {
    console.error(`[${adapter.logTag}] admin intercept guest update FAILED:`, guestErr.message);
  }

  await logAdministrativeRequestAlert(supabase, {
    phone,
    guestId,
    room: guestRoom,
    summary,
    rawText: text,
    conversationId,
    guestName,
    sourceLabel: adapter.sourceLabel,
  });

  if (!sim) {
    try {
      await adapter.sendReply(reply, "administrative_in_house_request");
    } catch (e) {
      console.error(`[${adapter.logTag}] admin intercept reply failed:`, (e as Error).message);
    }
  } else {
    console.info(`[${adapter.logTag}] SIM — administrative in-house intercept from ${phone}: ${summary}`);
  }

  console.info(
    `[${adapter.logTag}] administrative in-house intercept — phone:${phone} guest:${guestId} summary:${summary}`,
  );
}
