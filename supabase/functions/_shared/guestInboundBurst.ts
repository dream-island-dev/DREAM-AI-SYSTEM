// supabase/functions/_shared/guestInboundBurst.ts
// Rapid inbound burst coalescing + outbound duplicate guard — shared by Meta
// (whatsapp-webhook) and Whapi Suites DM (whapi-webhook).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { stripOutboundDispatchTag } from "./outboundDispatchTag.ts";

export type GuestInboxChannel = "meta" | "whapi";

/** Wait for trailing messages in the same burst before picking a leader. */
export const GUEST_BURST_COALESCE_MS = 1800;
/** Window for grouping back-to-back inbound from the same phone. */
export const GUEST_BURST_WINDOW_MS = 5000;
/** Skip identical outbound auto-replies to the same guest within this window. */
export const GUEST_OUTBOUND_COOLDOWN_MS = 120_000;

export function normalizeGuestOutboundBody(text: string): string {
  return stripOutboundDispatchTag(String(text ?? ""))
    .replace(/^\[WHAPI\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Leader of a rapid burst orchestrates one auto-reply; followers log only.
 * Mirrors whatsapp-webhook coalesceBurstIfLeader with per-channel isolation.
 */
export async function coalesceGuestInboundBurstIfLeader(
  supabase: SupabaseClient,
  phone: string,
  msgId: string,
  channel: GuestInboxChannel,
): Promise<{ proceed: boolean; coalescedText: string }> {
  await new Promise((r) => setTimeout(r, GUEST_BURST_COALESCE_MS));

  const since = new Date(Date.now() - GUEST_BURST_WINDOW_MS).toISOString();
  const { data: recentInbound } = await supabase
    .from("whatsapp_conversations")
    .select("message, wa_message_id, created_at")
    .eq("inbox_channel", channel)
    .eq("phone", phone)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const burst = (recentInbound ?? []) as Array<{ message: string; wa_message_id: string | null }>;
  if (burst.length === 0) return { proceed: true, coalescedText: "" };

  const leaderId = burst[0]?.wa_message_id;
  if (leaderId && leaderId !== msgId) {
    console.info(
      `[guestInboundBurst] burst delegate skip channel=${channel} msg:${msgId.slice(-8)} leader:${leaderId.slice(-8)}`,
    );
    return { proceed: false, coalescedText: "" };
  }

  const coalescedText = burst.map((b) => b.message).filter(Boolean).join("\n");
  return { proceed: true, coalescedText };
}

/** True when the same guest-facing body was already sent on this channel recently. */
export async function isDuplicateGuestOutboundRecently(
  supabase: SupabaseClient,
  phone: string,
  replyBody: string,
  channel: GuestInboxChannel,
): Promise<boolean> {
  const normalized = normalizeGuestOutboundBody(replyBody);
  if (!normalized) return false;

  const since = new Date(Date.now() - GUEST_OUTBOUND_COOLDOWN_MS).toISOString();
  const { data: recentOutbound } = await supabase
    .from("whatsapp_conversations")
    .select("message")
    .eq("inbox_channel", channel)
    .eq("phone", phone)
    .eq("direction", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);

  for (const row of recentOutbound ?? []) {
    if (normalizeGuestOutboundBody(String((row as { message?: string }).message ?? "")) === normalized) {
      return true;
    }
  }
  return false;
}
