// supabase/functions/_shared/executiveAssistant.test.ts
//
// Run: deno test --allow-env supabase/functions/_shared/executiveAssistant.test.ts
//
// Covers the CEO identity resolution + the per-tool server-side gates that
// the model's tool calls cannot bypass (description required on task
// creation, dedupe on learned rules, cancelled-guest block on guest sends).
// executeExecutiveTool is exported from executiveAssistant.ts specifically
// for this file — see the export's doc comment.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeExecutivePhoneDigits, isExecutiveInbound } from "./executiveIdentity.ts";
import { executeExecutiveTool, type ToolExecCtx } from "./executiveAssistant.ts";

const CTX: ToolExecCtx = { phone: "972505421751", originalText: "test", msgId: "msg1" };

function withEnv(key: string, value: string | undefined, fn: () => Promise<void> | void) {
  const prev = Deno.env.get(key);
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prev);
  });
}

/** Minimal single-chain Supabase query-builder stub — enough for the tool
 * executors under test, which each only touch one table/one call shape. */
function mockSupabase(opts: { maybeSingle?: { data: unknown; error: unknown }; default?: { data: unknown; error: unknown } }) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    ilike: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => builder,
    update: () => builder,
    maybeSingle: () => Promise.resolve(opts.maybeSingle ?? { data: null, error: null }),
    then: (resolve: any, reject?: any) =>
      Promise.resolve(opts.default ?? { data: null, error: null }).then(resolve, reject),
  };
  return { from: () => builder } as any;
}

Deno.test("normalizeExecutivePhoneDigits — local 0-prefix → 972 E.164 digits", () => {
  assertEquals(normalizeExecutivePhoneDigits("0505421751"), "972505421751");
  assertEquals(normalizeExecutivePhoneDigits("+972505421751"), "972505421751");
  assertEquals(normalizeExecutivePhoneDigits("972-50-542-1751"), "972505421751");
});

Deno.test("isExecutiveInbound — matches EXECUTIVE_PHONE secret regardless of inbound format", async () => {
  await withEnv("EXECUTIVE_PHONE", "972505421751", async () => {
    assertEquals(await isExecutiveInbound("0505421751"), true);
    assertEquals(await isExecutiveInbound("972505421751"), true);
    assertEquals(await isExecutiveInbound("972500000000"), false);
  });
});

Deno.test("isExecutiveInbound — no secret, no supabase → false (fails closed)", async () => {
  await withEnv("EXECUTIVE_PHONE", undefined, async () => {
    assertEquals(await isExecutiveInbound("972505421751"), false);
  });
});

Deno.test("create_executive_task — requires non-empty description", async () => {
  const result = await executeExecutiveTool(mockSupabase({}), "create_executive_task", {}, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "description_required");
});

Deno.test("send_guest_message — blocks a cancelled guest", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: 1, phone: "+972500000000", status: "cancelled", name: "Test" }, error: null },
  });
  const result = await executeExecutiveTool(
    supabase,
    "send_guest_message",
    { guest_id: 1, message: "שלום" },
    CTX,
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "guest_not_found_or_inactive");
});

Deno.test("learn_executive_rule — dedupes against an existing rule (trim + lowercase)", async () => {
  const supabase = mockSupabase({
    default: { data: [{ rule_text: "תמיד לענות בעברית" }], error: null },
  });
  const result = await executeExecutiveTool(
    supabase,
    "learn_executive_rule",
    { rule_text: "  תמיד לענות בעברית  " },
    CTX,
  );
  assertEquals(result.ok, true);
  assertEquals(result.deduped, true);
});

Deno.test("learn_executive_rule — requires non-empty rule_text", async () => {
  const supabase = mockSupabase({ default: { data: [], error: null } });
  const result = await executeExecutiveTool(supabase, "learn_executive_rule", { rule_text: "  " }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "rule_text_required");
});
