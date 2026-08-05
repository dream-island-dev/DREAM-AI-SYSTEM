// supabase/functions/_shared/ezgoDoc2SuiteRoomSync.test.ts
//
// Run: deno test --no-check --allow-env --allow-sys supabase/functions/_shared/ezgoDoc2SuiteRoomSync.test.ts
//
// File-local fake Supabase client (same convention as ezgoMailMatch.test.ts /
// guestClubWaInvite.test.ts — no shared mock exists yet).

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { upsertDoc2SuiteRoomForGuest } from "./ezgoDoc2SuiteRoomSync.ts";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";

type Call = { table: string; op: string; args?: unknown[] };

function fakeSupabase(opts: { existingByRoomRows?: Array<{ id: number }> }) {
  const calls: Call[] = [];
  const chain = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: (...args: unknown[]) => {
        calls.push({ table, op: "select", args });
        return builder;
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, op: "eq", args });
        return builder;
      },
      limit: async (...args: unknown[]) => {
        calls.push({ table, op: "limit", args });
        return { data: opts.existingByRoomRows ?? [], error: null };
      },
      maybeSingle: async () => {
        calls.push({ table, op: "maybeSingle" });
        return { data: null, error: null };
      },
      update: (patch: Record<string, unknown>) => {
        calls.push({ table, op: "update", args: [patch] });
        return {
          eq: async (...args: unknown[]) => {
            calls.push({ table, op: "update.eq", args });
            return { data: null, error: null };
          },
        };
      },
      insert: (row: Record<string, unknown>) => {
        calls.push({ table, op: "insert", args: [row] });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  const supabase = { from: (table: string) => chain(table) };
  return { supabase, calls };
}

const BASE_REC: Doc2Record = {
  _report: "doc2",
  section: "arrival",
  order_number: "280877",
  room_raw: "סוויטת אמטיסט - 8",
  room: "אמטיסט 8",
  board_basis: "HB",
  meal_location: "חצי פנסיון",
  arrival_time: null,
  nights: 2,
  guest_count: "2",
  guest_name: "רחל אופיר",
  phone: "+972545421426",
  amount: null,
  notes: null,
  arrival_date: "2026-07-21",
  departure_date: "2026-07-23",
  is_day_guest: false,
  is_premium_day: false,
};

Deno.test("upsertDoc2SuiteRoomForGuest: pre-existing duplicate rows for guest+room do not throw — updates the first row (P1 QA, 2026-08-05)", async () => {
  const { supabase, calls } = fakeSupabase({
    existingByRoomRows: [{ id: 101 }, { id: 102 }], // simulates the exact duplicate-chip bug being cleaned up
  });
  const result = await upsertDoc2SuiteRoomForGuest(supabase as never, {
    guestId: 10,
    rec: BASE_REC,
    reportDateYmd: "2026-07-21",
  });
  assertEquals(result.added, false);
  assertEquals(result.roomLabel, "אמטיסט 8");
  const updateEqCall = calls.find((c) => c.op === "update.eq");
  assertEquals(updateEqCall?.args?.[1], 101, "must update the first matching row, not crash on the duplicate");
  assertEquals(calls.some((c) => c.op === "insert"), false, "must not insert a third duplicate");
});

Deno.test("upsertDoc2SuiteRoomForGuest: no existing row → inserts", async () => {
  const { supabase, calls } = fakeSupabase({ existingByRoomRows: [] });
  const result = await upsertDoc2SuiteRoomForGuest(supabase as never, {
    guestId: 20,
    rec: BASE_REC,
    reportDateYmd: "2026-07-21",
  });
  assertEquals(result.added, true);
  assertEquals(calls.some((c) => c.op === "insert"), true);
});

Deno.test("upsertDoc2SuiteRoomForGuest: non-canonical room (e.g. stale בילוי יומי label) is skipped, not inserted", async () => {
  const { supabase, calls } = fakeSupabase({ existingByRoomRows: [] });
  const rec = { ...BASE_REC, room: "בילוי יומי" };
  const result = await upsertDoc2SuiteRoomForGuest(supabase as never, {
    guestId: 30,
    rec,
    reportDateYmd: "2026-07-21",
  });
  assertEquals(result.added, false);
  assertEquals(result.skippedReason, "non_canonical_room");
  assertEquals(calls.length, 0, "must not touch the DB at all");
});
