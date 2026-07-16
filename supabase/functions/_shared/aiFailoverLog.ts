// Fire-and-forget insert into ai_failover_events for AiFailoverWidget.js realtime banner.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function logAiFailoverEvent(
  supabase: SupabaseClient,
  opts: {
    from_engine: string;
    to_engine: string;
    error_message: string;
    guest_phone?: string | null;
  },
): void {
  supabase.from("ai_failover_events").insert([{
    from_engine: opts.from_engine,
    to_engine: opts.to_engine,
    error_message: opts.error_message,
    guest_phone: opts.guest_phone ?? null,
  }]).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.warn("[aiFailoverLog] insert failed (non-blocking):", error.message);
  });
}
