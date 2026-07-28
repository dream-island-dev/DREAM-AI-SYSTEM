// Post-send side effects when spa upsell goes out via whapi_outbound_jobs
// (SpaUpsellHub bulk path) — mirrors whatsapp-send GUEST_FLAG + audit rows.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadGuestByPhoneForStaffReply } from "./guestOutboundGuard.ts";
import { personalizeWhapiBody } from "./whapiMessagePersonalize.ts";

export async function applySpaUpsellWhapiSentSideEffects(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    name?: string | null;
    messageTemplate: string;
    wamid: string | null;
  },
): Promise<void> {
  const guest = await loadGuestByPhoneForStaffReply(supabase, opts.phone);
  if (!guest?.id) return;

  const body = personalizeWhapiBody(opts.messageTemplate, { name: opts.name });
  const guestPhone = String(guest.phone ?? opts.phone);

  await supabase
    .from("guests")
    .update({ msg_spa_upsell_sent: true })
    .eq("id", guest.id);

  await supabase.from("notification_log").insert({
    guest_id: guest.id,
    recipient: guestPhone,
    trigger_type: "spa_upsell_daypass",
    channel: "whatsapp",
    status: "sent",
    payload: {
      channel: "whapi_session",
      trigger: "spa_upsell_daypass",
      source: "spa_upsell_whapi_queue",
      ...(opts.wamid ? { wamid: opts.wamid } : {}),
    },
  });

  try {
    await supabase.from("whatsapp_conversations").insert({
      phone: guestPhone,
      guest_id: guest.id,
      direction: "outbound",
      message: `[WHAPI] ${body}`,
      wa_message_id: opts.wamid,
      inbox_channel: "whapi",
      channel: "whapi",
    });
  } catch (e) {
    console.warn("[spaUpsellWhapiSideEffects] conv log failed:", (e as Error).message);
  }
}
