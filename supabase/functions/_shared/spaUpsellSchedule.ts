import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INTER_SEND_DELAY_MS, sleep } from "./outboundThrottle.ts";

const STAGE_KEY = "spa_upsell_daypass";

/**
 * Staff-scheduled spa upsell rows (manual-only stage — is_active=false in
 * automation_stages, so the main cron scan never picks them up).
 */
export async function dispatchDueSpaUpsellScheduledTasks(
  supabase: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
  now: Date,
): Promise<number> {
  const { data: dueRows, error } = await supabase
    .from("scheduled_tasks")
    .select("guest_id, scheduled_for, force_channel")
    .eq("stage_key", STAGE_KEY)
    .eq("status", "pending")
    .eq("staff_scheduled", true)
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true });

  if (error) {
    console.warn("[spa-upsell-schedule] scheduled_tasks lookup failed:", error.message);
    return 0;
  }
  if (!dueRows?.length) return 0;

  let dispatched = 0;
  for (let i = 0; i < dueRows.length; i++) {
    const row = dueRows[i];
    const guestId = row.guest_id as number;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          guestId,
          trigger: STAGE_KEY,
          force: true,
          force_channel: (row.force_channel as string) || "whapi_session",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        dispatched++;
        const { error: markErr } = await supabase.rpc("mark_scheduled_task_dispatched", {
          p_guest_id: guestId,
          p_stage_key: STAGE_KEY,
        });
        if (markErr) {
          console.warn(
            `[spa-upsell-schedule] mark_scheduled_task_dispatched guest=${guestId}:`,
            markErr.message,
          );
        }
        console.log(
          `[spa-upsell-schedule] dispatched guest_id=${guestId} scheduled_for=${row.scheduled_for}`,
        );
      } else {
        console.warn(
          `[spa-upsell-schedule] send failed guest_id=${guestId} status=${body?.status ?? res.status} ` +
          `error=${body?.error ?? "unknown"}`,
        );
      }
    } catch (e) {
      console.warn(`[spa-upsell-schedule] fetch failed guest_id=${guestId}:`, (e as Error).message);
    }
    if (i < dueRows.length - 1) await sleep(INTER_SEND_DELAY_MS);
  }
  return dispatched;
}
