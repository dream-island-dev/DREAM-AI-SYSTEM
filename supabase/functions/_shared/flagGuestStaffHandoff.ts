// supabase/functions/_shared/flagGuestStaffHandoff.ts
// When the bot sends canonical staff-handoff copy, flag the inbound row +
// guest attention — shared by Meta (whatsapp-webhook) and Whapi guest DM.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isGuestStaffHandoffReply } from "./guestBotHandoff.ts";
import { patchClaimedInbound } from "./guestInboundOrchestrator.ts";

export async function flagGuestStaffHandoff(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    claimedConversationId: number | null;
    waMessageId?: string | null;
    replyText: string;
    humanRequestType?: string;
    attentionReason?: string;
    logTag?: string;
  },
): Promise<boolean> {
  if (!isGuestStaffHandoffReply(opts.replyText)) return false;

  await patchClaimedInbound(
    supabase,
    opts.claimedConversationId,
    opts.waMessageId ?? "",
    {
      guest_id: opts.guestId,
      human_requested: true,
      human_request_type: opts.humanRequestType ?? "staff_handoff",
    },
  );

  if (opts.guestId) {
    const { error } = await supabase.from("guests").update({
      requires_attention: true,
      requires_attention_since: new Date().toISOString(),
      needs_callback: true,
      attention_reason: opts.attentionReason ?? "שאלה מורכבת לצוות",
    }).eq("id", opts.guestId);
    if (error) {
      console.error(`[${opts.logTag ?? "flagGuestStaffHandoff"}] guest update failed:`, error.message);
    }
  }

  console.info(
    `[${opts.logTag ?? "flagGuestStaffHandoff"}] staff handoff — red alert flagged — phone:${opts.phone} guest:${opts.guestId ?? "unknown"}`,
  );
  return true;
}
