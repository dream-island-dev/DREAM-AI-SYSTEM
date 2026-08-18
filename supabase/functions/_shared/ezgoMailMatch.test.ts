// supabase/functions/_shared/ezgoMailMatch.test.ts
//
// Run: deno test --no-check --allow-env --allow-sys supabase/functions/_shared/ezgoMailMatch.test.ts
//
// File-local fake Supabase client (same convention as guestClubWaInvite.test.ts /
// automationClaim.test.ts — no shared mock exists yet). applyCertainSuiteSpaEnrichment
// makes at most 2 calls: guests.select().eq().maybeSingle() (fresh guest re-fetch),
// then guests.update(patch).eq() (the write) — captured in `updates` so a test can
// assert the exact patch written, not just that *something* was.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { applyCertainSuiteSpaEnrichment, findGuestForDoc1Enrichment, type MatchResult, type GuestRow } from "./ezgoMailMatch.ts";
import type { Doc1Record } from "./ezgoDoc1Parser.ts";

type FakeResult = { data: unknown; error: { message?: string } | null };

function fakeSupabase(fetchResult: FakeResult) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  let updateOk = true;
  const chain = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => fetchResult,
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return {
          eq: async () => (
            updateOk ? { data: null, error: null } : { data: null, error: { message: "update failed" } }
          ),
        };
      },
    };
    return builder;
  };
  const supabase = { from: (table: string) => chain(table) };
  return { supabase, updates, setUpdateFails: (v: boolean) => { updateOk = !v; } };
}

const FRESH_GUEST_BASE = {
  id: 1, name: "יעל כהן", phone: "+972501234567", order_number: "123",
  arrival_date: "2026-08-10", departure_date: "2026-08-12",
  spa_time: null, spa_date: null, meal_time: null, meal_location: null,
  treatment_count: null, guest_profile: null as Record<string, unknown> | null,
};

const BASE_MATCH: MatchResult = {
  guest: { id: 1 } as never,
  method: "order",
  confidence: 0.95,
  label: "סוויטה · מס׳ 123",
  action: "enrich",
  patch: { spa_time: "12:00", _workflow: "suite_spa_sync" },
};

const BASE_REC = {
  order_number: "123",
  guest_name: "יעל כהן",
  phone: "+972501234567",
  arrival_date: "2026-08-10",
  spa_time: "12:00",
  meal_time: null,
  meal_location: "חצי פנסיון",
  treatment_count: 1,
  spa_slots: null,
} as unknown as Doc1Record;

Deno.test("applyCertainSuiteSpaEnrichment: applies for order-match suite_spa_sync, writes only enrichment fields", async () => {
  const { supabase, updates } = fakeSupabase({
    data: { ...FRESH_GUEST_BASE, guest_profile: { vip: true } },
    error: null,
  });
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, BASE_MATCH);
  assertEquals(ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].table, "guests");
  assertEquals(updates[0].patch.spa_time, "12:00");
  assertEquals(updates[0].patch.meal_location, "חצי פנסיון");
  assertEquals("_workflow" in updates[0].patch, false, "must never write the internal workflow marker to guests");
  assertEquals("arrival_date" in updates[0].patch, false, "enrichment must never touch stay dates");
  assertEquals("room" in updates[0].patch, false, "enrichment must never touch room");
  assertEquals("name" in updates[0].patch, false, "enrichment must never touch the guest name");
});

Deno.test("applyCertainSuiteSpaEnrichment: preserves unrelated guest_profile keys instead of wiping them", async () => {
  const { supabase, updates } = fakeSupabase({
    data: {
      ...FRESH_GUEST_BASE,
      guest_profile: { vip: true, allergies: "בוטנים", spa: { therapist_pref: "female" } },
    },
    error: null,
  });
  const rec = { ...BASE_REC, spa_slots: [{ time: "12:00", count: 1 }] } as Doc1Record;
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, rec, BASE_MATCH);
  assertEquals(ok, true);
  const profile = updates[0].patch.guest_profile as Record<string, unknown>;
  assertEquals(profile.vip, true);
  assertEquals(profile.allergies, "בוטנים");
  assertEquals((profile.spa as Record<string, unknown>).therapist_pref, "female");
  assertEquals(!!(profile.spa as Record<string, unknown>).doc1_slots, true);
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies for a phone-matched line", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, method: "phone", confidence: 0.85 };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0, "must not touch the DB at all for a non-order match");
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies for a fuzzy-matched line", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, method: "fuzzy", confidence: 0.8 };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies below the confidence floor", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, confidence: 0.5 };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies a conflict", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, action: "conflict" };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies outside the suite_spa_sync workflow", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, patch: { room: "אמטיסט 3", _workflow: "suite_arrival_enrich" } };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: applies suite enrich (meal only) on order match", async () => {
  const { supabase, updates } = fakeSupabase({
    data: { ...FRESH_GUEST_BASE, guest_profile: null },
    error: null,
  });
  const rec = { ...BASE_REC, spa_time: null } as Doc1Record;
  const match: MatchResult = {
    ...BASE_MATCH,
    guest: { id: 1, room: "אמטיסט 8" } as never,
    patch: { meal_location: "חצי פנסיון", _workflow: "enrich" },
  };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, rec, match);
  assertEquals(ok, true);
  assertEquals(updates[0].patch.meal_location, "חצי פנסיון");
  assertEquals("spa_time" in updates[0].patch && updates[0].patch.spa_time != null, false);
});

Deno.test("applyCertainSuiteSpaEnrichment: never auto-applies daypass enrich", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = {
    ...BASE_MATCH,
    guest: { id: 1, room: "Premium Day 1", room_type: "day_guest" } as never,
    patch: { meal_location: "חצי פנסיון", _workflow: "enrich" },
  };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: never applies without a matched guest id", async () => {
  const { supabase, updates } = fakeSupabase({ data: null, error: null });
  const match: MatchResult = { ...BASE_MATCH, guest: null };
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, match);
  assertEquals(ok, false);
  assertEquals(updates.length, 0);
});

Deno.test("applyCertainSuiteSpaEnrichment: guest fetch failure falls back to false, not a throw", async () => {
  const { supabase } = fakeSupabase({ data: null, error: { message: "boom" } });
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, BASE_MATCH);
  assertEquals(ok, false);
});

Deno.test("applyCertainSuiteSpaEnrichment: update failure falls back to false (line stays pending_review upstream)", async () => {
  const { supabase, setUpdateFails } = fakeSupabase({
    data: { ...FRESH_GUEST_BASE },
    error: null,
  });
  setUpdateFails(true);
  const ok = await applyCertainSuiteSpaEnrichment(supabase as never, BASE_REC, BASE_MATCH);
  assertEquals(ok, false);
});

// P0 2026-08-05: a "972…" (no leading +) rec.phone used to miss the exact-string
// match against guests.phone's "+972…" and fall through to daypass_create,
// spawning a split-brain duplicate for a guest who already has an active suite
// stay covering the date.
Deno.test("findGuestForDoc1Enrichment: normalized-phone fallback finds the suite guest despite a +/no-+ mismatch", () => {
  const suiteGuest = {
    id: 1,
    phone: "+972501111111",
    order_number: null,
    arrival_date: "2026-07-18",
    departure_date: "2026-07-20",
    room: "אמטיסט 8",
  } as unknown as GuestRow;
  const rec = { phone: "972501111111", arrival_date: "2026-07-19", spa_time: "14:00" } as Doc1Record;
  assertEquals(findGuestForDoc1Enrichment([suiteGuest], rec), suiteGuest);
});
