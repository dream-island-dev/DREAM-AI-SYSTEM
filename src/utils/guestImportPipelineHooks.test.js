import { runGuestImportPipelineHooks } from "./guestImportPipelineHooks";

/** Minimal mock — guest.status "checked_in" short-circuits the housekeeping
 * reconcile branch so these tests isolate the late-import fast-lane gate. */
function makeMockSupabase() {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === "guests") {
        return {
          update(patch) {
            updates.push(patch);
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe("runGuestImportPipelineHooks — allowLateImportFastLane gate (P0 2026-08-05)", () => {
  const eligibleGuest = {
    id: 42,
    status: "checked_in",
    room_type: "suite",
    arrival_date: new Date().toISOString().slice(0, 10),
  };

  test("default (import path) applies the fast-lane arrival_confirmed patch", async () => {
    const supabase = makeMockSupabase();
    const result = await runGuestImportPipelineHooks(supabase, eligibleGuest, []);
    expect(result.lateImportApplied).toBe(true);
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0].arrival_confirmed).toBe(true);
  });

  test("allowLateImportFastLane:false (edit path) never touches arrival_confirmed", async () => {
    const supabase = makeMockSupabase();
    const result = await runGuestImportPipelineHooks(supabase, eligibleGuest, [], {
      allowLateImportFastLane: false,
    });
    expect(result.lateImportApplied).toBe(false);
    expect(supabase.updates).toHaveLength(0);
  });

  test("allowLateImportFastLane:true (explicit, e.g. create path) still applies", async () => {
    const supabase = makeMockSupabase();
    const result = await runGuestImportPipelineHooks(supabase, eligibleGuest, [], {
      allowLateImportFastLane: true,
    });
    expect(result.lateImportApplied).toBe(true);
  });
});
