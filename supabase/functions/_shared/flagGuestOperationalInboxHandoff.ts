// supabase/functions/_shared/flagGuestOperationalInboxHandoff.ts
//
// Human-First cutover (2026-07-22): when WhatsApp free-text looks like an
// in-house ops ask, the bot NEVER opens an Ops Board task on its own
// (keyword/LLM false positives flooded the field-ops queue). Instead it
// raises the same Inbox human-handoff signal staff already use for
// "מבקש מענה אנושי" — human_requested on the inbound row + needs_callback /
// requires_attention on guests — and leaves opening a real task to a
// human (Inbox / OperationsBoard) or to the Guest Portal's trusted-button
// path (deterministic taps, not free-text guessing).
//
// Callers still patch the inbound conversation row themselves (Meta vs
// Whapi claim helpers differ); this helper only owns the guests.* flags.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const OPERATIONAL_INBOX_HUMAN_REQUEST_TYPE = "operational_request";

export async function flagGuestOperationalInboxHandoff(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    /** Staff-facing short reason — stored on guests.attention_reason. */
    attentionReason: string;
    logTag?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const tag = opts.logTag ?? "flagGuestOperationalInboxHandoff";
  const { error } = await supabase.from("guests").update({
    requires_attention:       true,
    requires_attention_since: new Date().toISOString(),
    needs_callback:           true,
    attention_reason:         opts.attentionReason,
  }).eq("id", opts.guestId);
  if (error) {
    console.error(`[${tag}] guests operational inbox flag FAILED:`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
