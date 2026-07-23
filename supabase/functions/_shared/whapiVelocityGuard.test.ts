// supabase/functions/_shared/whapiVelocityGuard.test.ts
//
// Run: deno test --no-check --allow-env supabase/functions/_shared/whapiVelocityGuard.test.ts
//
// File-local fake Supabase client (same convention as automationClaim.test.ts —
// no shared mock exists yet). Every builder step is both chainable AND
// thenable so it satisfies call sites that terminate with `.maybeSingle()`
// and ones that `await` the builder directly (array-returning selects,
// `.insert()`).

import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assertWhapiVelocityAllowed,
  classifyWhapiRisk,
  isPostBanCooldownActive,
  isWhapiGroupId,
  sendWhapiTextGuarded,
  WhapiRateLimitedError,
  __resetWhapiVelocityLimitsCacheForTest,
} from "./whapiVelocityGuard.ts";

type FakeResult = { data: unknown; error: { message?: string } | null };

function fakeSupabase(responses: FakeResult[]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let responseIndex = 0;
  const nextResponse = (): FakeResult => {
    const r = responses[responseIndex] ?? { data: null, error: null };
    responseIndex += 1;
    return r;
  };
  const chain = (op: string) => {
    const record = { op, args: [] as unknown[] };
    calls.push(record);
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: (...a: unknown[]) => { record.args.push(["select", ...a]); return builder; },
      insert: (...a: unknown[]) => { record.args.push(["insert", ...a]); return builder; },
      eq: (...a: unknown[]) => { record.args.push(["eq", ...a]); return builder; },
      in: (...a: unknown[]) => { record.args.push(["in", ...a]); return builder; },
      gte: (...a: unknown[]) => { record.args.push(["gte", ...a]); return builder; },
      order: (...a: unknown[]) => { record.args.push(["order", ...a]); return builder; },
      limit: (...a: unknown[]) => { record.args.push(["limit", ...a]); return builder; },
      maybeSingle: async () => nextResponse(),
      then: (resolve: (r: FakeResult) => void, reject: (e: unknown) => void) =>
        Promise.resolve(nextResponse()).then(resolve, reject),
    };
    return builder;
  };
  const supabase = { from: (table: string) => chain(table) };
  return { supabase, calls };
}

const LIMITS_RESPONSE: FakeResult = { data: { config_value: null }, error: null }; // → DEFAULT_WHAPI_VELOCITY_LIMITS
const NO_STATE: FakeResult = { data: { config_value: null }, error: null }; // → cooldown inactive

Deno.test("isWhapiGroupId: recognizes @g.us suffix only", () => {
  assertEquals(isWhapiGroupId("120363429859248777@g.us"), true);
  assertEquals(isWhapiGroupId("972546294885"), false);
});

Deno.test("isPostBanCooldownActive: true when cooldown_until is in the future", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  assertEquals(isPostBanCooldownActive({ last_ban_at: null, cooldown_until: "2026-07-25T00:00:00Z" }, now), true);
  assertEquals(isPostBanCooldownActive({ last_ban_at: null, cooldown_until: "2026-07-20T00:00:00Z" }, now), false);
  assertEquals(isPostBanCooldownActive({ last_ban_at: null, cooldown_until: null }, now), false);
});

Deno.test("classifyWhapiRisk: hot when inbound Whapi found in last 14 days", async () => {
  const { supabase } = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const tier = await classifyWhapiRisk(supabase, "972500000001");
  assertEquals(tier, "hot");
});

Deno.test("classifyWhapiRisk: warm when no Whapi inbound but an active guest row exists", async () => {
  const { supabase } = fakeSupabase([
    { data: null, error: null }, // no whapi inbound
    { data: { status: "checked_in" }, error: null }, // active guest
  ]);
  const tier = await classifyWhapiRisk(supabase, "972500000002");
  assertEquals(tier, "warm");
});

Deno.test("classifyWhapiRisk: cold when guest row exists but is cancelled (not active)", async () => {
  const { supabase } = fakeSupabase([
    { data: null, error: null },
    { data: { status: "cancelled" }, error: null },
    { data: null, error: null }, // no meta inbound either
  ]);
  const tier = await classifyWhapiRisk(supabase, "972500000003");
  assertEquals(tier, "cold");
});

Deno.test("classifyWhapiRisk: warm when no guest row but inbound Meta in last 30 days", async () => {
  const { supabase } = fakeSupabase([
    { data: null, error: null },
    { data: null, error: null },
    { data: { id: 5 }, error: null },
  ]);
  const tier = await classifyWhapiRisk(supabase, "972500000004");
  assertEquals(tier, "warm");
});

Deno.test("classifyWhapiRisk: cold — waiter/vendor with zero history (the 2026-07-23 incident shape)", async () => {
  const { supabase } = fakeSupabase([
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const tier = await classifyWhapiRisk(supabase, "972500000005");
  assertEquals(tier, "cold");
});

Deno.test("assertWhapiVelocityAllowed: group send is fully exempt — no DB calls at all", async () => {
  const { supabase, calls } = fakeSupabase([]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "120363429859248777@g.us", body: "task card", sendClass: "group",
  });
  assertEquals(decision, { allowed: true, riskTier: "group" });
  assertEquals(calls.length, 0);
});

Deno.test("assertWhapiVelocityAllowed: staff send allowed when global gap is clear, skips tier caps entirely", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const staleSend = new Date(Date.now() - 3600_000).toISOString();
  const { supabase, calls } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: staleSend }, error: null }, // global gap check — 1h ago, clear
  ]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "972546294885", body: "daily pulse", sendClass: "staff",
  });
  assertEquals(decision, { allowed: true, riskTier: "staff" });
  // No classifyWhapiRisk / per-recipient cap calls should have run for staff.
  assertEquals(calls.length, 2);
});

Deno.test("assertWhapiVelocityAllowed: staff send blocked by global_min_gap_sec even though staff is cap-exempt", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const recentSend = new Date(Date.now() - 3_000).toISOString(); // 3s ago < 10s global gap
  const { supabase } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: recentSend }, error: null },
  ]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "972546294885", body: "digest", sendClass: "staff",
  });
  assertEquals(decision.allowed, false);
  if (!decision.allowed) {
    assertEquals(decision.riskTier, "staff");
    assertEquals(decision.retryAfterSec > 0, true);
  }
});

Deno.test("assertWhapiVelocityAllowed: cold guest blocked outright during post-ban cooldown", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const staleSend = new Date(Date.now() - 3600_000).toISOString();
  const activeCooldownState: FakeResult = {
    data: { config_value: JSON.stringify({ last_ban_at: "2026-07-23T00:00:00Z", cooldown_until: "2099-01-01T00:00:00Z" }) },
    error: null,
  };
  const { supabase } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: staleSend }, error: null }, // global gap clear
    activeCooldownState,
    { data: null, error: null }, // classifyWhapiRisk: no whapi inbound
    { data: null, error: null }, // no guest row
    { data: null, error: null }, // no meta inbound → cold
  ]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "972500009999", body: "סקר", sendClass: "guest",
  });
  assertEquals(decision.allowed, false);
  if (!decision.allowed) assertEquals(decision.riskTier, "cold");
});

Deno.test("assertWhapiVelocityAllowed: guest blocked by per-recipient gap_sec (cold tier, 45s)", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const staleSend = new Date(Date.now() - 3600_000).toISOString();
  const recentToThisRecipient = new Date(Date.now() - 5_000).toISOString(); // 5s ago < 45s cold gap
  const { supabase } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: staleSend }, error: null }, // global gap clear
    NO_STATE, // cooldown inactive
    { data: null, error: null }, // classify: no whapi inbound
    { data: null, error: null }, // no guest row
    { data: null, error: null }, // no meta inbound → cold
    { data: [{ sent_at: recentToThisRecipient }], error: null }, // per-recipient recent rows
  ]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "972500001234", body: "היי! נשמח לדעתך", sendClass: "guest",
  });
  assertEquals(decision.allowed, false);
  if (!decision.allowed) assertEquals(decision.riskTier, "cold");
});

Deno.test("assertWhapiVelocityAllowed: hot guest allowed well within caps", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const staleSend = new Date(Date.now() - 3600_000).toISOString();
  const { supabase } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: staleSend }, error: null },
    NO_STATE,
    { data: { id: 1 }, error: null }, // hot: whapi inbound found
    { data: [], error: null }, // no prior sends to this recipient today
  ]);
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: "972500005678", body: "תודה שמסרת שעת הגעה", sendClass: "guest",
  });
  assertEquals(decision, { allowed: true, riskTier: "hot" });
});

Deno.test("sendWhapiTextGuarded: blocked decision throws WhapiRateLimitedError before attempting the real send", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const recentSend = new Date(Date.now() - 1_000).toISOString();
  const { supabase } = fakeSupabase([
    LIMITS_RESPONSE,
    { data: { sent_at: recentSend }, error: null }, // global gap blocks immediately
  ]);
  await assertRejects(
    () => sendWhapiTextGuarded(supabase, "972546294885", "hello", { sendClass: "staff" }),
    WhapiRateLimitedError,
  );
});
