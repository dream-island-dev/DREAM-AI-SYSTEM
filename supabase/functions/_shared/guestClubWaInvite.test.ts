// supabase/functions/_shared/guestClubWaInvite.test.ts
//
// Run: deno test --no-check --allow-env --allow-sys supabase/functions/_shared/guestClubWaInvite.test.ts
//
// File-local fake Supabase client (same convention as automationClaim.test.ts /
// whapiVelocityGuard.test.ts — no shared mock exists yet). Responses are consumed in
// call order regardless of table name, so each test lists exactly the sequence
// enqueueGuestClubWaInvite is expected to make: bot_config → automation_stages →
// guests → (conditionally) guest_club_members → cancel-prior-pending update → insert.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { enqueueGuestClubWaInvite } from "./guestClubWaInvite.ts";

type FakeResult = { data: unknown; error: { message?: string; code?: string } | null };

function fakeSupabase(responses: FakeResult[]) {
  const calls: Array<{ table: string; op: string }> = [];
  let responseIndex = 0;
  const nextResponse = (): FakeResult => {
    const r = responses[responseIndex] ?? { data: null, error: null };
    responseIndex += 1;
    return r;
  };
  const chain = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: () => builder,
      insert: (...a: unknown[]) => { calls.push({ table, op: "insert" }); void a; return builder; },
      update: (...a: unknown[]) => { calls.push({ table, op: "update" }); void a; return builder; },
      eq: () => builder,
      maybeSingle: async () => {
        calls.push({ table, op: "maybeSingle" });
        return nextResponse();
      },
      then: (resolve: (r: FakeResult) => void, reject: (e: unknown) => void) =>
        Promise.resolve(nextResponse()).then(resolve, reject),
    };
    return builder;
  };
  const supabase = { from: (table: string) => chain(table) };
  return { supabase, calls };
}

const SETTINGS_DEFAULT: FakeResult = { data: null, error: null }; // → wa_invite_enabled true
const SETTINGS_DISABLED: FakeResult = {
  data: { config_value: { wa_invite_enabled: false } },
  error: null,
};
const STAGE_ACTIVE: FakeResult = { data: null, error: null }; // is_active !== false → true
const OK_UPDATE: FakeResult = { data: null, error: null };

Deno.test("enqueueGuestClubWaInvite: wa_invite_disabled short-circuits before any guest lookup", async () => {
  const { supabase, calls } = fakeSupabase([SETTINGS_DISABLED]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 1 });
  assertEquals(result, { queued: false, reason: "wa_invite_disabled" });
  assertEquals(calls.length, 1, "must not query stage/guest once WA invite is globally disabled");
});

Deno.test("enqueueGuestClubWaInvite: guest_cancelled blocks the invite", async () => {
  const { supabase } = fakeSupabase([
    SETTINGS_DEFAULT,
    STAGE_ACTIVE,
    { data: { id: 5, status: "cancelled", club_status: null, msg_club_invite_sent: false, phone: "+972501112222" }, error: null },
  ]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 5 });
  assertEquals(result, { queued: false, reason: "guest_cancelled" });
});

Deno.test("enqueueGuestClubWaInvite: already_sent blocks a second invite for the same guest", async () => {
  const { supabase } = fakeSupabase([
    SETTINGS_DEFAULT,
    STAGE_ACTIVE,
    { data: { id: 6, status: "checked_out", club_status: null, msg_club_invite_sent: true, phone: "+972501112222" }, error: null },
  ]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 6 });
  assertEquals(result, { queued: false, reason: "already_sent" });
});

Deno.test("enqueueGuestClubWaInvite: club_member_active blocks — guest already joined the club", async () => {
  const { supabase } = fakeSupabase([
    SETTINGS_DEFAULT,
    STAGE_ACTIVE,
    { data: { id: 7, status: "checked_out", club_status: null, msg_club_invite_sent: false, phone: "+972501112222" }, error: null },
    { data: { status: "active" }, error: null }, // guest_club_members row
  ]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 7 });
  assertEquals(result, { queued: false, reason: "club_member_active" });
});

Deno.test("enqueueGuestClubWaInvite: enqueue is idempotent — a unique-violation on insert is reported, not thrown", async () => {
  // Simulates guest_club_invite_queue_one_pending (migration 276's partial unique index)
  // rejecting a second concurrent enqueue for a guest that already has a pending row.
  const { supabase, calls } = fakeSupabase([
    SETTINGS_DEFAULT,
    STAGE_ACTIVE,
    { data: { id: 8, status: "checked_in", club_status: null, msg_club_invite_sent: false, phone: "+972501112222" }, error: null },
    { data: null, error: null }, // guest_club_members: no row
    OK_UPDATE, // cancel-prior-pending update
    { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }, // insert
  ]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 8 });
  assertEquals(result, { queued: false, reason: "already_queued" });
  assertEquals(calls.some((c) => c.table === "guest_club_invite_queue" && c.op === "insert"), true);
});

Deno.test("enqueueGuestClubWaInvite: queues successfully when nothing blocks it", async () => {
  const { supabase } = fakeSupabase([
    SETTINGS_DEFAULT,
    STAGE_ACTIVE,
    { data: { id: 9, status: "checked_in", club_status: null, msg_club_invite_sent: false, phone: "+972501112222" }, error: null },
    { data: null, error: null }, // guest_club_members: no row
    OK_UPDATE,
    { data: null, error: null }, // insert succeeds
  ]);
  const result = await enqueueGuestClubWaInvite(supabase as never, { guestId: 9 });
  assertEquals(result, { queued: true });
});
