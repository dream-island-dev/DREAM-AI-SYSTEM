// supabase/functions/_shared/automationClaim.test.ts
//
// Run: deno test supabase/functions/_shared/automationClaim.test.ts
//
// No shared Supabase-client test mock exists in this codebase yet (every
// other _shared/*.test.ts covers pure functions only) — this file adds a
// minimal, file-local fake scoped to exactly the chains automationClaim.ts
// calls (insert().select().maybeSingle(), select().eq()...maybeSingle(),
// update().eq().eq().select().maybeSingle()). Not proposed as a shared test
// utility; a real integration/manual test against Supabase is still the
// authoritative check for migration 195's actual unique-index behavior
// (Postgres enforces the real conflict — this only exercises the TS-side
// branching against scripted responses).

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { claimDispatchAttempt, finalizeDispatchAttempt } from "./automationClaim.ts";

type FakeResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Records every insert/select/update call in order; returns scripted
 * results from `responses` in call order, one per terminal (.maybeSingle()). */
function fakeSupabase(responses: FakeResult[]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let responseIndex = 0;
  const nextResponse = (): FakeResult => {
    const r = responses[responseIndex] ?? { data: null, error: { message: "no scripted response" } };
    responseIndex += 1;
    return r;
  };

  const chain = (op: string) => {
    const record = { op, args: [] as unknown[] };
    calls.push(record);
    const builder: Record<string, unknown> = {
      insert: (row: unknown) => { record.args.push(["insert", row]); return builder; },
      update: (patch: unknown) => { record.args.push(["update", patch]); return builder; },
      select: (cols: unknown) => { record.args.push(["select", cols]); return builder; },
      eq: (col: unknown, val: unknown) => { record.args.push(["eq", col, val]); return builder; },
      order: (col: unknown, opts: unknown) => { record.args.push(["order", col, opts]); return builder; },
      limit: (n: unknown) => { record.args.push(["limit", n]); return builder; },
      maybeSingle: async () => nextResponse(),
    };
    return builder;
  };

  const supabase = {
    from: (_table: string) => chain(_table),
  };
  return { supabase, calls };
}

Deno.test("claimDispatchAttempt: force=true bypasses the uniqueness check entirely, one insert", async () => {
  const { supabase, calls } = fakeSupabase([{ data: { id: 42 }, error: null }]);
  const result = await claimDispatchAttempt(supabase as never, {
    guestId: 1, triggerType: "mid_stay", recipient: "+972500000000", force: true,
  });
  assertEquals(result, { claimed: true, logId: 42 });
  assertEquals(calls.length, 1);
});

Deno.test("claimDispatchAttempt: no conflict → single insert succeeds, claimed", async () => {
  const { supabase } = fakeSupabase([{ data: { id: 7 }, error: null }]);
  const result = await claimDispatchAttempt(supabase as never, {
    guestId: 2, triggerType: "checkout_fb", recipient: "+972500000001",
  });
  assertEquals(result, { claimed: true, logId: 7 });
});

Deno.test("claimDispatchAttempt: unique violation + fresh processing row → in_flight, no reclaim attempted", async () => {
  const { supabase } = fakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }, // insert
    { data: { id: 9, sent_at: new Date().toISOString() }, error: null }, // lookup — 0 min old
  ]);
  const result = await claimDispatchAttempt(supabase as never, {
    guestId: 3, triggerType: "pre_arrival_2d", recipient: "+972500000002",
  });
  assertEquals(result, { claimed: false, reason: "in_flight" });
});

Deno.test("claimDispatchAttempt: unique violation + stale processing row → reclaims and re-inserts, claimed", async () => {
  const staleSentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min old > 5 min stale threshold
  const { supabase } = fakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }, // first insert
    { data: { id: 9, sent_at: staleSentAt }, error: null }, // lookup — stale
    { data: { id: 9 }, error: null }, // optimistic reclaim UPDATE succeeds
    { data: { id: 15 }, error: null }, // retried insert succeeds
  ]);
  const result = await claimDispatchAttempt(supabase as never, {
    guestId: 4, triggerType: "spa_warmup_daypass", recipient: "+972500000003",
  });
  assertEquals(result, { claimed: true, logId: 15 });
});

Deno.test("claimDispatchAttempt: unique violation + stale row, but reclaim UPDATE loses the race → in_flight (no fight)", async () => {
  const staleSentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { supabase } = fakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }, // first insert
    { data: { id: 9, sent_at: staleSentAt }, error: null }, // lookup — stale
    { data: null, error: null }, // reclaim UPDATE affected 0 rows (already finalized elsewhere)
  ]);
  const result = await claimDispatchAttempt(supabase as never, {
    guestId: 5, triggerType: "survey_invite_daypass", recipient: "+972500000004",
  });
  assertEquals(result, { claimed: false, reason: "in_flight" });
});

Deno.test("finalizeDispatchAttempt: updates the claimed row by id, does not insert a new row", async () => {
  const { supabase, calls } = fakeSupabase([{ data: { id: 42 }, error: null }]);
  await finalizeDispatchAttempt(supabase as never, 42, "sent", { channel: "meta_template" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].op, "notification_log");
  const [firstArg] = calls[0].args as Array<[string, unknown]>;
  assertEquals(firstArg[0], "update");
});
