// Browser post-create hooks — mirrors guestImportPipelineHooks.ts (2026-08-05).
import { buildLateImportFastLanePatch } from "./lateImportFastLane";
import { reconcileHousekeepingCheckInForGuest } from "./housekeepingCheckInReconcile";

export async function runGuestImportPipelineHooks(supabase, guest, suiteRoomRows = []) {
  const result = {
    lateImportApplied: false,
    housekeepingCheckInApplied: false,
    guestPatch: null,
  };
  if (!supabase || !guest?.id) return result;

  const fastLanePatch = buildLateImportFastLanePatch(guest);
  if (fastLanePatch) {
    const { error } = await supabase.from("guests").update(fastLanePatch).eq("id", guest.id);
    if (!error) {
      result.lateImportApplied = true;
      result.guestPatch = { ...fastLanePatch };
      guest = { ...guest, ...fastLanePatch };
    }
  }

  const hk = await reconcileHousekeepingCheckInForGuest(supabase, guest, suiteRoomRows);
  if (hk?.applied) {
    result.housekeepingCheckInApplied = true;
    result.guestPatch = { ...(result.guestPatch ?? {}), ...(hk.guestPatch ?? {}) };
  }

  return result;
}
