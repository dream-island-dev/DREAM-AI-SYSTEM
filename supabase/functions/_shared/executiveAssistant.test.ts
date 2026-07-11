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
import { normalizeExecutivePhoneDigits, isExecutiveInbound, resolveExecutiveInbound } from "./executiveIdentity.ts";
import {
  executeExecutiveTool,
  resolveExecutiveReplyTo,
  executiveAlreadyRepliedSuccessfully,
  fetchExecutiveRules,
  type ToolExecCtx,
} from "./executiveAssistant.ts";

const CTX: ToolExecCtx = { phone: "972505421751", originalText: "test", msgId: "msg1", ownerPhone: "972505421751" };

function withEnv(key: string, value: string | undefined, fn: () => Promise<void> | void) {
  const prev = Deno.env.get(key);
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prev);
  });
}

async function withEnvs(vars: Record<string, string>, fn: () => Promise<void> | void) {
  const prev = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

async function withFetch(handler: (input: unknown, init?: unknown) => Promise<Response>, fn: () => Promise<void> | void) {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = prevFetch;
  }
}

/** Minimal single-chain Supabase query-builder stub — enough for the tool
 * executors under test, which each only touch one table/one call shape.
 * `or` is captured (not just chained) so owner_phone-scoping tests can
 * assert on the exact filter string built for fetchExecutiveRules. */
function mockSupabase(opts: {
  maybeSingle?: { data: unknown; error: unknown };
  default?: { data: unknown; error: unknown };
  onOr?: (filter: string) => void;
}) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    ilike: () => builder,
    or: (filter: string) => { opts.onOr?.(filter); return builder; },
    gte: () => builder,
    lt: () => builder,
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

Deno.test("isExecutiveInbound — known executive resolves without env or supabase (KNOWN_EXECUTIVES fast path)", async () => {
  await withEnv("EXECUTIVE_PHONE", undefined, async () => {
    assertEquals(await isExecutiveInbound("972505421751"), true);
  });
});

Deno.test("resolveExecutiveInbound — Mike QA number (0506842439)", async () => {
  await withEnv("EXECUTIVE_PHONE", undefined, async () => {
    const profile = await resolveExecutiveInbound("0506842439");
    assertEquals(profile?.phoneDigits, "972506842439");
    assertEquals(profile?.displayName, "מייק");
    assertEquals(await isExecutiveInbound("972506842439"), true);
  });
});

Deno.test("resolveExecutiveInbound — Eliad canonical number without env", async () => {
  await withEnv("EXECUTIVE_PHONE", undefined, async () => {
    const profile = await resolveExecutiveInbound("972505421751");
    assertEquals(profile?.displayName, "אליעד");
  });
});

Deno.test("isExecutiveInbound — unknown number → false", async () => {
  await withEnv("EXECUTIVE_PHONE", undefined, async () => {
    assertEquals(await isExecutiveInbound("972500000000"), false);
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

Deno.test("learn_executive_rule — dedupes against an existing shared rule (trim + lowercase)", async () => {
  const supabase = mockSupabase({
    default: { data: [{ rule_text: "תמיד לענות בעברית", owner_phone: null }], error: null },
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

Deno.test("learn_executive_rule — dedupes against the caller's own private rule", async () => {
  const supabase = mockSupabase({
    default: { data: [{ rule_text: "דבר איתי טכני", owner_phone: CTX.ownerPhone }], error: null },
  });
  const result = await executeExecutiveTool(supabase, "learn_executive_rule", { rule_text: "דבר איתי טכני" }, CTX);
  assertEquals(result.ok, true);
  assertEquals(result.deduped, true);
});

Deno.test("learn_executive_rule — does NOT dedupe against another executive's private rule (owner_phone scoping)", async () => {
  const supabase = mockSupabase({
    default: { data: [{ rule_text: "דבר איתי טכני", owner_phone: "972506842439" }], error: null },
  });
  const result = await executeExecutiveTool(supabase, "learn_executive_rule", { rule_text: "דבר איתי טכני" }, CTX);
  assertEquals(result.ok, true);
  assertEquals(result.deduped, undefined);
  assertEquals(result.inserted, true);
});

Deno.test("fetchExecutiveRules — builds an owner_phone filter scoped to the caller (shared + own)", async () => {
  let capturedFilter = "";
  const supabase = mockSupabase({
    default: { data: [{ rule_text: "כלל א" }], error: null },
    onOr: (filter) => { capturedFilter = filter; },
  });
  const text = await fetchExecutiveRules(supabase, "972505421751");
  assertEquals(capturedFilter, "owner_phone.is.null,owner_phone.eq.972505421751");
  assertEquals(text.includes("כלל א"), true);
});

Deno.test("learn_executive_rule — requires non-empty rule_text", async () => {
  const supabase = mockSupabase({ default: { data: [], error: null } });
  const result = await executeExecutiveTool(supabase, "learn_executive_rule", { rule_text: "  " }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "rule_text_required");
});

Deno.test("resolveExecutiveReplyTo — prefers inbound DM chat_id over bare phone", () => {
  assertEquals(
    resolveExecutiveReplyTo("972506842439", "972506842439@s.whatsapp.net"),
    "972506842439@s.whatsapp.net",
  );
  assertEquals(
    resolveExecutiveReplyTo("972506842439", "972506842439@c.us"),
    "972506842439@c.us",
  );
  assertEquals(resolveExecutiveReplyTo("+972-50-684-2439", null), "972506842439");
  assertEquals(resolveExecutiveReplyTo("972506842439", "120363xxx@g.us"), "972506842439");
});

Deno.test("executiveAlreadyRepliedSuccessfully — true when outbound wamid exists after inbound", async () => {
  let call = 0;
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    not: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: { created_at: "2026-07-11T10:00:00Z" }, error: null });
      return Promise.resolve({ data: { id: 99 }, error: null });
    },
  };
  const supabase = { from: () => builder } as any;
  assertEquals(await executiveAlreadyRepliedSuccessfully(supabase, "972506842439", "wamid-1"), true);
});

// ══════════════════════════════════════════════════════════════════════════════
// update_task_status
// ══════════════════════════════════════════════════════════════════════════════

Deno.test("update_task_status — requires task_id or room", async () => {
  const result = await executeExecutiveTool(mockSupabase({}), "update_task_status", { new_status: "done" }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "task_id_or_room_required");
});

Deno.test("update_task_status — rejects an invalid new_status", async () => {
  const result = await executeExecutiveTool(
    mockSupabase({}),
    "update_task_status",
    { new_status: "cancelled", task_id: "t1" },
    CTX,
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_new_status");
});

Deno.test("update_task_status — ambiguous room match returns candidates instead of guessing", async () => {
  const supabase = mockSupabase({
    default: {
      data: [
        { id: "t1", room_number: "8", description: "מזגן לא עובד", status: "open", department: "תפעול" },
        { id: "t2", room_number: "8", description: "מגבות חסרות", status: "open", department: "משק" },
      ],
      error: null,
    },
  });
  const result = await executeExecutiveTool(supabase, "update_task_status", { room: "8", new_status: "done" }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "ambiguous_task");
  assertEquals((result.candidates as unknown[]).length, 2);
});

Deno.test("update_task_status — done transition succeeds by task_id", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: "t1", room_number: "8", description: "x", status: "open", department: "תפעול" }, error: null },
    default: { data: null, error: null },
  });
  const result = await executeExecutiveTool(supabase, "update_task_status", { task_id: "t1", new_status: "done" }, CTX);
  assertEquals(result.ok, true);
  assertEquals(result.status, "done");
});

Deno.test("update_task_status — rejected is blocked unless task is pending_approval", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: "t1", room_number: "8", description: "x", status: "open", department: "תפעול" }, error: null },
  });
  const result = await executeExecutiveTool(supabase, "update_task_status", { task_id: "t1", new_status: "rejected" }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "not_pending_approval");
});

Deno.test("update_task_status — approve (open) dispatches through notify-manual-task", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: "t1", room_number: "8", description: "x", status: "pending_approval", department: "תפעול" }, error: null },
  });
  await withEnvs({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "svc-key" }, async () => {
    await withFetch(
      (input) => {
        assertEquals(String(input).includes("notify-manual-task"), true);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, notified: true }), { status: 200 }));
      },
      async () => {
        const result = await executeExecutiveTool(supabase, "update_task_status", { task_id: "t1", new_status: "open" }, CTX);
        assertEquals(result.ok, true);
        assertEquals(result.approved, true);
        assertEquals(result.group_card_sent, true);
      },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// list_guest_alerts / get_room_status / get_ops_digest_now
// ══════════════════════════════════════════════════════════════════════════════

Deno.test("list_guest_alerts — empty board reports no open requests", async () => {
  const supabase = mockSupabase({ default: { data: [], error: null } });
  const result = await executeExecutiveTool(supabase, "list_guest_alerts", {}, CTX);
  assertEquals(result.ok, true);
  assertEquals(result.count, 0);
});

Deno.test("list_guest_alerts — labels a known alert_type in the summary", async () => {
  const supabase = mockSupabase({
    default: {
      data: [{ id: 1, alert_type: "spa_request", message: "רוצה עיסוי מחר", guests: { name: "דנה", room: "אמטיסט 8" } }],
      error: null,
    },
  });
  const result = await executeExecutiveTool(supabase, "list_guest_alerts", {}, CTX);
  assertEquals(result.ok, true);
  assertEquals(result.count, 1);
  assertEquals((result.summary as string).includes("💆"), true);
});

Deno.test("get_room_status — unknown room reports room_not_found (FAIL VISIBLE, not a fake default)", async () => {
  const supabase = mockSupabase({ default: { data: [], error: null } });
  const result = await executeExecutiveTool(supabase, "get_room_status", { room: "999" }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "room_not_found");
});

Deno.test("get_room_status — known room returns its status", async () => {
  const supabase = mockSupabase({
    default: { data: [{ room_id: "205", status: "ניקיון", notes: null, updated_at: "2026-07-11T10:00:00Z" }], error: null },
  });
  const result = await executeExecutiveTool(supabase, "get_room_status", { room: "205" }, CTX);
  assertEquals(result.ok, true);
  assertEquals((result.summary as string).includes("ניקיון"), true);
});

Deno.test("get_ops_digest_now — rejects an invalid period", async () => {
  const result = await executeExecutiveTool(mockSupabase({}), "get_ops_digest_now", { period: "yearly" }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_period");
});

Deno.test("get_ops_digest_now — read-only happy path composes a digest without writing resort_digest_log", async () => {
  const supabase = mockSupabase({ default: { data: [], error: null } });
  const result = await executeExecutiveTool(supabase, "get_ops_digest_now", { period: "daily" }, CTX);
  assertEquals(result.ok, true);
  assertEquals(typeof result.digest, "string");
  assertEquals((result.digest as string).length > 0, true);
});

// ══════════════════════════════════════════════════════════════════════════════
// set_guest_status (room_ready only)
// ══════════════════════════════════════════════════════════════════════════════

Deno.test("set_guest_status — requires guest_id or room", async () => {
  const result = await executeExecutiveTool(mockSupabase({}), "set_guest_status", {}, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "guest_id_or_room_required");
});

Deno.test("set_guest_status — blocks a day-pass guest (suite-only tool)", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: 1, phone: "+972500000000", status: "pending", room: "Premium Day 1", room_type: "day_guest" }, error: null },
  });
  const result = await executeExecutiveTool(supabase, "set_guest_status", { guest_id: 1 }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "day_pass_guest_not_supported");
});

Deno.test("set_guest_status — blocks an invalid status transition (already checked_in)", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: 1, phone: "+972500000000", status: "checked_in", room: "אמטיסט 8", room_type: "suite" }, error: null },
  });
  const result = await executeExecutiveTool(supabase, "set_guest_status", { guest_id: 1 }, CTX);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_status_transition");
  assertEquals(result.current_status, "checked_in");
});

Deno.test("set_guest_status — flips status and reports FAIL VISIBLE when unconfigured (no silent success)", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: 1, phone: "+972500000000", status: "expected", room: "אמטיסט 8", room_type: "suite" }, error: null },
    default: { data: null, error: null },
  });
  await withEnvs({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, async () => {
    const result = await executeExecutiveTool(supabase, "set_guest_status", { guest_id: 1 }, CTX);
    assertEquals(result.ok, true);
    assertEquals(result.status, "room_ready");
    assertEquals(result.guest_notified, false);
  });
});

Deno.test("set_guest_status — flips status and sends the guest notification via whatsapp-send", async () => {
  const supabase = mockSupabase({
    maybeSingle: { data: { id: 1, phone: "+972500000000", status: "expected", room: "אמטיסט 8", room_type: "suite" }, error: null },
    default: { data: null, error: null },
  });
  await withEnvs({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "svc-key" }, async () => {
    await withFetch(
      (input) => {
        assertEquals(String(input).includes("whatsapp-send"), true);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
      async () => {
        const result = await executeExecutiveTool(supabase, "set_guest_status", { guest_id: 1 }, CTX);
        assertEquals(result.ok, true);
        assertEquals(result.guest_notified, true);
      },
    );
  });
});

Deno.test("executiveAlreadyRepliedSuccessfully — false when no successful outbound yet", async () => {
  let call = 0;
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    not: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: { created_at: "2026-07-11T10:00:00Z" }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const supabase = { from: () => builder } as any;
  assertEquals(await executiveAlreadyRepliedSuccessfully(supabase, "972506842439", "wamid-1"), false);
});
