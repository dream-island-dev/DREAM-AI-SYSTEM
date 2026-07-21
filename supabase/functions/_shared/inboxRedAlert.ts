// supabase/functions/_shared/inboxRedAlert.ts
// Global Red Alert — surfaces ANY guest_alerts (Requests Board) insert as the
// same red/pulsing treatment WhatsAppInbox.js already renders for date-change
// and human-callback requests (migration 020's human_requested/
// human_request_type on whatsapp_conversations). Reuses that exact plumbing
// instead of adding new Inbox state: WhatsAppInbox.js's groupByPhone()/
// ContactItem never change — they already sort human-requested contacts
// first, pulse the avatar dot, and render the dismiss badge purely off
// human_requested/human_request_type on the guest's latest INBOUND row (see
// groupByPhone's `row.direction === "inbound"` check — an outbound row's
// flag is invisible to the UI, which is why this only ever touches inbound
// rows).
//
// Call this right after every successful guest_alerts insert (never
// blocking — best-effort, matches every other alert side-effect in this
// codebase, e.g. guest-portal-upsell's Adir Whapi ping).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Same normalisation contract as every other Deno function-boundary
// duplicate of this helper (GuestContextDrawer.js's frontend twin, etc.) —
// covers +972/972/0-prefixed local Israeli mobile formats.
function phoneVariants(bare: string): string[] {
  const digits = bare.replace(/\D/g, "");
  if (!digits) return [bare];
  const noPlus = digits.startsWith("972") ? digits : `972${digits.replace(/^0/, "")}`;
  return [...new Set([`+${noPlus}`, noPlus, `0${noPlus.slice(3)}`])];
}

export type InboxAlertChannel = "meta" | "whapi";

/** Channel order for red-alert lookup — preferred first, then fallback. */
export function inboxAlertChannelLookupOrder(
  preferred?: InboxAlertChannel | null,
): InboxAlertChannel[] {
  if (preferred === "whapi") return ["whapi", "meta"];
  return ["meta"];
}

export async function triggerInboxRedAlert(
  supabase: SupabaseClient,
  opts: {
    guestId: number | null;
    phone: string;
    conversationId?: number | null;
    summary?: string | null;
    /** Suite portal flows pass "whapi" so the red dot lands on the Suites thread. */
    preferredInboxChannel?: InboxAlertChannel | null;
  },
): Promise<void> {
  const { guestId, phone, conversationId, summary, preferredInboxChannel } = opts;
  if (!phone) return;

  const markerChannel: InboxAlertChannel =
    preferredInboxChannel === "whapi" ? "whapi" : "meta";
  const markerMessage = summary
    ? `[מערכת] ${summary}`
    : "[מערכת] בקשה חדשה נוצרה בלוח הבקשות.";

  try {
    // Fast path — the caller already knows the exact inbound row that
    // triggered this alert (every whatsapp-webhook call site does; portal-
    // triggered alerts never do, since no WhatsApp message caused them).
    if (conversationId) {
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ human_requested: true, human_request_type: "guest_alert" })
        .eq("id", conversationId);
      if (!error) return;
      console.warn("[inboxRedAlert] direct row flag failed, falling back:", error.message);
    }

    const variants = phoneVariants(phone);
    for (const channel of inboxAlertChannelLookupOrder(preferredInboxChannel)) {
      const { data: latestInbound, error: lookupErr } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .in("phone", variants)
        .eq("inbox_channel", channel)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lookupErr) {
        console.warn(`[inboxRedAlert] latest-inbound lookup failed (${channel}):`, lookupErr.message);
        continue;
      }
      if (latestInbound?.id) {
        const { error } = await supabase
          .from("whatsapp_conversations")
          .update({ human_requested: true, human_request_type: "guest_alert" })
          .eq("id", latestInbound.id);
        if (error) console.warn("[inboxRedAlert] flag latest inbound failed:", error.message);
        return;
      }
    }

    // No inbound history — insert a system marker on the guest's primary channel
    // so they surface in the unified Inbox roster with the red flag.
    const { error } = await supabase.from("whatsapp_conversations").insert({
      phone,
      guest_id:   guestId,
      inbox_channel: markerChannel,
      direction:  "inbound",
      message:    markerMessage,
      wa_message_id: null,
      human_requested: true,
      human_request_type: "guest_alert",
    });
    if (error) console.warn("[inboxRedAlert] marker row insert failed:", error.message);
  } catch (e) {
    console.warn("[inboxRedAlert] unexpected failure:", (e as Error).message);
  }
}
