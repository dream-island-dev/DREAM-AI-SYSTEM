// Browser post-create hooks — mirrors guestImportPipelineHooks.ts (2026-08-05).
import { buildLateImportFastLanePatch } from "./lateImportFastLane";
import { reconcileHousekeepingCheckInForGuest } from "./housekeepingCheckInReconcile";

/**
 * @param {object} options
 * @param {boolean} [options.allowLateImportFastLane=true] - Pass false for a
 *   routine edit of an already-existing guest (e.g. AddGuestModal isEdit) so a
 *   staff correction never fakes arrival_confirmed for a guest who hasn't
 *   actually replied. Genuine import paths (Doc2 create/enrich) keep the
 *   default true — that's the guest's real point of entry into the system.
 */
export async function runGuestImportPipelineHooks(supabase, guest, suiteRoomRows = [], options = {}) {
  const { allowLateImportFastLane = true } = options;
  const result = {
    lateImportApplied: false,
    housekeepingCheckInApplied: false,
    guestPatch: null,
  };
  if (!supabase || !guest?.id) return result;

  const fastLanePatch = allowLateImportFastLane ? buildLateImportFastLanePatch(guest) : null;
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
