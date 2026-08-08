import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { persistHousekeepingNearMiss } from "./housekeepingNearMissSignal.ts";

// deno-lint-ignore no-explicit-any
function makeMockSupabase(insertResponse: { error: any }, capture?: { row?: any }) {
  return {
    from(table: string) {
      if (table !== "housekeeping_wa_events") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert(row: unknown) {
          if (capture) capture.row = row;
          return Promise.resolve(insertResponse);
        },
      };
      // deno-lint-ignore no-explicit-any
    },
  } as any;
}

Deno.test("persistHousekeepingNearMiss: records with null room_number/room_id, event_type near_miss", async () => {
  const capture: { row?: Record<string, unknown> } = {};
  const supabase = makeMockSupabase({ error: null }, capture);
  const result = await persistHousekeepingNearMiss(supabase, {
    waMessageId: "wamid.1",
    sourceLine: "9ci garbage",
    fromPhone: "972500000001",
    fromName: "Adir",
    profileId: null,
  });
  assertEquals(result, { ok: true, action: "recorded" });
  assertEquals(capture.row?.event_type, "near_miss");
  assertEquals(capture.row?.room_number, null);
  assertEquals(capture.row?.room_id, null);
  assertEquals(capture.row?.wa_message_id, "wamid.1");
  assertEquals(capture.row?.source_line, "9ci garbage");
});

Deno.test("persistHousekeepingNearMiss: unique_violation (23505) on retried WA delivery is a dedup, not an error", async () => {
  const supabase = makeMockSupabase({ error: { code: "23505", message: "duplicate key" } });
  const result = await persistHousekeepingNearMiss(supabase, {
    waMessageId: "wamid.2",
    sourceLine: "??",
  });
  assertEquals(result, { ok: true, action: "dedup" });
});

Deno.test("persistHousekeepingNearMiss: other DB errors surface visibly, never swallowed", async () => {
  const supabase = makeMockSupabase({ error: { code: "42501", message: "permission denied" } });
  const result = await persistHousekeepingNearMiss(supabase, {
    waMessageId: "wamid.3",
    sourceLine: "??",
  });
  assertEquals(result.ok, false);
  assertEquals(result.action, "error");
  assertEquals(result.error, "permission denied");
});

Deno.test("persistHousekeepingNearMiss: source_line truncated to 500 chars (matches other housekeeping signals)", async () => {
  const capture: { row?: Record<string, unknown> } = {};
  const supabase = makeMockSupabase({ error: null }, capture);
  const longLine = "x".repeat(600);
  await persistHousekeepingNearMiss(supabase, { waMessageId: "wamid.4", sourceLine: longLine });
  assertEquals((capture.row?.source_line as string).length, 500);
});
