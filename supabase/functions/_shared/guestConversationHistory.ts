// supabase/functions/_shared/guestConversationHistory.ts
// Cross-channel chat history for guest LLM — Meta + Whapi merged per phone.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { stripOutboundDispatchTag } from "./outboundDispatchTag.ts";

export type GuestChatHistoryTurn = { direction: string; message: string };

const DEFAULT_LIMIT = 6;

/**
 * Fetches recent conversation turns for LLM context.
 * unified=true merges meta+whapi chronologically (Inbox parity for the brain).
 */
export async function fetchGuestChatHistory(
  supabase: SupabaseClient,
  phone: string,
  opts?: { limit?: number; channel?: "meta" | "whapi" | "unified" },
): Promise<GuestChatHistoryTurn[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const channel = opts?.channel ?? "unified";

  let query = supabase
    .from("whatsapp_conversations")
    .select("direction, message, created_at, inbox_channel")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(channel === "unified" ? limit * 3 : limit);

  if (channel !== "unified") {
    query = query.eq("inbox_channel", channel);
  } else {
    query = query.in("inbox_channel", ["meta", "whapi"]);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[guestConversationHistory] fetch failed:", error.message);
    return [];
  }

  const rows = ((data ?? []) as Array<{
    direction: string;
    message: string;
    created_at: string;
    inbox_channel?: string;
  }>)
    .map((h) => ({
      direction: h.direction,
      message: stripOutboundDispatchTag(h.message),
      created_at: h.created_at,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return rows.slice(-limit).map(({ direction, message }) => ({ direction, message }));
}
