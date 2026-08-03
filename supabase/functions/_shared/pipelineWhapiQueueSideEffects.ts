// Post-send side effects for pipeline triggers sent via whapi_outbound_jobs.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadGuestByPhoneForStaffReply } from "./guestOutboundGuard.ts";

const GUEST_FLAG_BY_TRIGGER: Record<string, string> = {
  pre_arrival_2d: "msg_pre_arrival_2d_sent",
  night_before: "msg_pre_arrival_sent",
  morning_suite: "msg_morning_suite_sent",
  morning_welcome: "msg_morning_welcome_sent",
  room_ready: "msg_room_ready_sent",
  mid_stay: "msg_mid_stay_sent",
  mid_stay_daypass: "msg_mid_stay_sent",
  checkout_fb: "msg_checkout_fb_sent",
  checkout_fb_daypass: "msg_checkout_fb_sent",
  night_before_daypass: "msg_pre_arrival_sent",
  stage_2_arrival: "msg_stage_2_arrival_sent",
  survey_invite_daypass: "msg_survey_invite_sent",
  guest_club_invite: "msg_club_invite_sent",
  spa_warmup_daypass: "msg_spa_warmup_sent",
  spa_upsell_daypass: "msg_spa_upsell_sent",
};

export async function applyPipelineWhapiQueueSideEffects(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    trigger: string | null;
    source?: string | null;
    wamid: string | null;
    body: string;
  },
): Promise<void> {
  const trigger = String(opts.trigger ?? "").trim();
  const flagCol = GUEST_FLAG_BY_TRIGGER[trigger];
  if (!flagCol) return;

  const guest = await loadGuestByPhoneForStaffReply(supabase, opts.phone);
  if (!guest?.id) return;

  const guestPhone = String(guest.phone ?? opts.phone);

  await supabase.from("guests").update({ [flagCol]: true }).eq("id", guest.id);

  await supabase.from("notification_log").insert({
    guest_id: guest.id,
    recipient: guestPhone,
    trigger_type: trigger,
    channel: "whatsapp",
    status: "sent",
    payload: {
      channel: "whapi_session",
      trigger,
      source: opts.source ?? "whapi_outbound_queue",
      ...(opts.wamid ? { wamid: opts.wamid } : {}),
    },
  });

  try {
    await supabase.from("whatsapp_conversations").insert({
      phone: guestPhone,
      guest_id: guest.id,
      direction: "outbound",
      message: `[WHAPI] ${opts.body}`,
      wa_message_id: opts.wamid,
      inbox_channel: "whapi",
      channel: "whapi",
    });
  } catch (e) {
    console.warn("[pipelineWhapiQueueSideEffects] conv log failed:", (e as Error).message);
  }
}
