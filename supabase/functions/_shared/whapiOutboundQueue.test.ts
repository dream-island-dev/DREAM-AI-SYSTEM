// supabase/functions/_shared/whapiOutboundQueue.test.ts
// Run: deno test --no-check --allow-env supabase/functions/_shared/whapiOutboundQueue.test.ts

import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  claimNextDueWhapiJob,
  enqueueWhapiBulkJob,
  finalizeWhapiJobSent,
  getWhapiJobBatchStatus,
  MAX_WHAPI_JOB_ATTEMPTS,
  rescheduleOrFailWhapiJob,
  type WhapiOutboundJobRow,
} from "./whapiOutboundQueue.ts";
import { __resetWhapiVelocityLimitsCacheForTest } from "./whapiVelocityGuard.ts";

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
      update: (...a: unknown[]) => { record.args.push(["update", ...a]); return builder; },
      eq: (...a: unknown[]) => { record.args.push(["eq", ...a]); return builder; },
      lte: (...a: unknown[]) => { record.args.push(["lte", ...a]); return builder; },
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

const LIMITS_RESPONSE: FakeResult = { data: { config_value: null }, error: null };

function baseJob(overrides: Partial<WhapiOutboundJobRow> = {}): WhapiOutboundJobRow {
  return {
    id: "job-1", batch_id: "batch-1", status: "sending", phone: "972500000001", name: "דנה",
    message_template: "היי {{שם}}!", risk_tier: "cold", trigger: "waiter_pulse", source: "whapi-bulk-dispatch",
    scheduled_after: new Date().toISOString(), attempts: 0, last_error: null, wamid: null,
    created_at: new Date().toISOString(), sent_at: null,
    ...overrides,
  };
}

Deno.test("enqueueWhapiBulkJob: rejects an empty recipient list", async () => {
  const { supabase } = fakeSupabase([]);
  await assertRejects(() => enqueueWhapiBulkJob(supabase, {
    recipients: [], messageTemplate: "היי {{שם}}", trigger: "t", source: "s",
  }));
});

Deno.test("enqueueWhapiBulkJob: rejects a batch larger than bulk_max_recipients_per_job", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const { supabase } = fakeSupabase([LIMITS_RESPONSE]);
  const recipients = Array.from({ length: 61 }, (_, i) => ({ phone: `97250000${i}`, name: "X" }));
  await assertRejects(
    () => enqueueWhapiBulkJob(supabase, { recipients, messageTemplate: "היי {{שם}}", trigger: "t", source: "s" }),
    Error,
    "whapi_bulk_too_large",
  );
});

Deno.test("enqueueWhapiBulkJob: rejects 3+ recipients when template has no {{שם}} placeholder", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const { supabase } = fakeSupabase([LIMITS_RESPONSE]);
  const recipients = [{ phone: "1" }, { phone: "2" }, { phone: "3" }];
  await assertRejects(
    () => enqueueWhapiBulkJob(supabase, { recipients, messageTemplate: "שלום לכולם", trigger: "t", source: "s" }),
    Error,
    "whapi_bulk_requires_name_placeholder",
  );
});

Deno.test("enqueueWhapiBulkJob: stagger is monotonically increasing across recipients", async () => {
  __resetWhapiVelocityLimitsCacheForTest();
  const { supabase, calls } = fakeSupabase([LIMITS_RESPONSE, { data: null, error: null }]);
  const recipients = [{ phone: "1", name: "א" }, { phone: "2", name: "ב" }, { phone: "3", name: "ג" }];
  const result = await enqueueWhapiBulkJob(supabase, {
    recipients, messageTemplate: "היי {{שם}}!", trigger: "waiter_pulse", source: "whapi-bulk-dispatch",
  });
  assertEquals(result.queued, 3);
  const insertCall = calls.find((c) => c.op === "whapi_outbound_jobs");
  const [, rows] = insertCall!.args[0] as [string, Array<{ scheduled_after: string }>];
  const times = rows.map((r) => new Date(r.scheduled_after).getTime());
  assertEquals(times[0] <= times[1], true);
  assertEquals(times[1] < times[2], true);
});

Deno.test("claimNextDueWhapiJob: returns null when nothing is due", async () => {
  const { supabase } = fakeSupabase([{ data: null, error: null }]);
  const job = await claimNextDueWhapiJob(supabase);
  assertEquals(job, null);
});

Deno.test("claimNextDueWhapiJob: claims the candidate via a status-guarded UPDATE", async () => {
  const candidate = baseJob({ status: "pending" });
  const { supabase } = fakeSupabase([
    { data: candidate, error: null },
    { data: { ...candidate, status: "sending" }, error: null },
  ]);
  const job = await claimNextDueWhapiJob(supabase);
  assertEquals(job?.id, "job-1");
  assertEquals(job?.status, "sending");
});

Deno.test("claimNextDueWhapiJob: another tick already claimed it -> update affects 0 rows -> null", async () => {
  const candidate = baseJob({ status: "pending" });
  const { supabase } = fakeSupabase([
    { data: candidate, error: null },
    { data: null, error: null }, // lost the race
  ]);
  const job = await claimNextDueWhapiJob(supabase);
  assertEquals(job, null);
});

Deno.test("rescheduleOrFailWhapiJob: reschedules (stays pending) below MAX_WHAPI_JOB_ATTEMPTS", async () => {
  const { supabase, calls } = fakeSupabase([{ data: null, error: null }]);
  const outcome = await rescheduleOrFailWhapiJob(supabase, baseJob({ attempts: 1 }), "whapi_rate_limited: ...", 45);
  assertEquals(outcome, "rescheduled");
  const updateCall = calls[0].args[0] as [string, Record<string, unknown>];
  assertEquals(updateCall[1].status, "pending");
  assertEquals(updateCall[1].attempts, 2);
});

Deno.test("rescheduleOrFailWhapiJob: marks failed once attempts reach MAX_WHAPI_JOB_ATTEMPTS", async () => {
  const { supabase, calls } = fakeSupabase([{ data: null, error: null }]);
  const outcome = await rescheduleOrFailWhapiJob(
    supabase,
    baseJob({ attempts: MAX_WHAPI_JOB_ATTEMPTS - 1 }),
    "whapi_rate_limited: ...",
    45,
  );
  assertEquals(outcome, "failed");
  const updateCall = calls[0].args[0] as [string, Record<string, unknown>];
  assertEquals(updateCall[1].status, "failed");
});

Deno.test("finalizeWhapiJobSent: marks sent with wamid + timestamp", async () => {
  const { supabase, calls } = fakeSupabase([{ data: null, error: null }]);
  await finalizeWhapiJobSent(supabase, "job-1", "wamid-123");
  const updateCall = calls[0].args[0] as [string, Record<string, unknown>];
  assertEquals(updateCall[1].status, "sent");
  assertEquals(updateCall[1].wamid, "wamid-123");
});

Deno.test("getWhapiJobBatchStatus: aggregates counts by status", async () => {
  const { supabase } = fakeSupabase([
    { data: [{ status: "sent" }, { status: "sent" }, { status: "failed" }, { status: "pending" }], error: null },
  ]);
  const status = await getWhapiJobBatchStatus(supabase, "batch-1");
  assertEquals(status, { total: 4, pending: 1, sending: 0, sent: 2, failed: 1, cancelled: 0, done: 3 });
});
