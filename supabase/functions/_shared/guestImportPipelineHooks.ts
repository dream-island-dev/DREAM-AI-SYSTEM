// Post-create hooks: late-import fast lane + HK group reconcile (2026-08-05).

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildLateImportFastLanePatch } from "./lateImportFastLane.ts";
import { reconcileGuestHousekeepingCheckInAfterImport } from "./housekeepingImportReconcile.ts";

export interface GuestImportPipelineResult {
  lateImportApplied: boolean;
  housekeepingCheckInApplied: boolean;
  guestPatch?: Record<string, unknown>;
}

export async function runGuestImportPipelineHooks(
  supabase: ReturnType<typeof createClient>,
  guestId: number,
): Promise<GuestImportPipelineResult> {
  const result: GuestImportPipelineResult = {
    lateImportApplied: false,
    housekeepingCheckInApplied: false,
  };

  const { data: guest, error } = await supabase
    .from("guests")
    .select(
      "id, arrival_date, arrival_confirmed, arrival_confirmed_at, automation_scope, automation_muted, room_type, status",
    )
    .eq("id", guestId)
    .maybeSingle();
  if (error || !guest) return result;

  const fastLanePatch = buildLateImportFastLanePatch(guest);
  if (fastLanePatch) {
    const { error: updErr } = await supabase.from("guests").update(fastLanePatch).eq("id", guestId);
    if (!updErr) {
      result.lateImportApplied = true;
      result.guestPatch = { ...(result.guestPatch ?? {}), ...fastLanePatch };
    } else {
      console.warn("[guestImportPipelineHooks] late-import patch failed:", updErr.message);
    }
  }

  const hk = await reconcileGuestHousekeepingCheckInAfterImport(supabase, guestId);
  if (hk.applied) {
    result.housekeepingCheckInApplied = true;
    result.guestPatch = { ...(result.guestPatch ?? {}), ...(hk.guestPatch ?? {}) };
  }

  return result;
}
