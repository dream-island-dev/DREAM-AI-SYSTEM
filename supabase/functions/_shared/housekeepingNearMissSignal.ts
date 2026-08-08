// B3 (2026-08-08): durable, queryable audit row for housekeeping-group
// near-miss / unparsed lines (HK anchor present, no room resolved).
//
// Before this, a near-miss only ever got a console.warn when
// HOUSEKEEPING_WA_GROUP_REPLY=false (the group is receive-only, migration
// 287-era P0) — invisible to anyone who isn't reading Supabase function logs.
// This persists the same event as a housekeeping_wa_events row (event_type
// 'near_miss', migration 289) so recurring unparsed patterns are queryable
// from the UI/DB instead of only a log line — the row write itself never
// sends anything to the WA group, matching the silence rule exactly like
// applyHousekeepingCheckInSignal's DB write already does.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface HousekeepingNearMissPersistResult {
  ok: boolean;
  action: "recorded" | "dedup" | "error";
  error?: string;
}

export async function persistHousekeepingNearMiss(
  supabase: ReturnType<typeof createClient>,
  opts: {
    waMessageId: string;
    sourceLine?: string | null;
    fromPhone?: string | null;
    fromName?: string | null;
    profileId?: string | null;
  },
): Promise<HousekeepingNearMissPersistResult> {
  const { error } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: opts.waMessageId,
    room_number: null,
    room_id: null,
    event_type: "near_miss",
    source_line: opts.sourceLine?.slice(0, 500) ?? null,
    from_phone: opts.fromPhone ?? null,
    from_name: opts.fromName ?? null,
    profile_id: opts.profileId ?? null,
  });

  if (error) {
    // 23505 = unique_violation — dedup index on (wa_message_id) WHERE
    // event_type='near_miss' (migration 289): a retried WhatsApp delivery of
    // an already-recorded near-miss, not a failure.
    if (error.code === "23505") {
      return { ok: true, action: "dedup" };
    }
    console.warn(`[housekeepingNearMiss] persist failed msg=${opts.waMessageId}:`, error.message);
    return { ok: false, action: "error", error: error.message };
  }
  return { ok: true, action: "recorded" };
}
