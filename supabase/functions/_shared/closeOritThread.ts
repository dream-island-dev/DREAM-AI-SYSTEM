// Close / reopen Orit CS threads — single source for UI, Sigal, and mail-send.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function isOritThreadClosed(
  thread: { status?: string | null } | null | undefined,
): boolean {
  const s = thread?.status;
  return s === "handled" || s === "archived";
}

export async function closeOritThread(
  supabase: SupabaseClient,
  threadId: string,
  opts?: { handledAt?: string },
): Promise<void> {
  await supabase.from("orit_agent_threads").update({
    status: "handled",
    handled_at: opts?.handledAt ?? new Date().toISOString(),
    workflow_step: null,
    orit_chat_pending: null,
  }).eq("id", threadId);
}
