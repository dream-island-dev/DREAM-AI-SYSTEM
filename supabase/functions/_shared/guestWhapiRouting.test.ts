// supabase/functions/_shared/guestWhapiRouting.test.ts
//
// Run: deno test --allow-env supabase/functions/_shared/guestWhapiRouting.test.ts
//
// shouldRouteGuestOutboundViaWhapiSuites is the single gate whatsapp-send's
// shouldUseWhapiForGuestAutomation() now wraps directly (2026-07-10 — the
// dispatch_channel and Shabbat-only gates were removed). These tests cover
// the routing rule itself: suite guests always route to Whapi once the flag
// is on, regardless of arrival day-of-week or dispatch_channel; day-pass
// guests never do.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { shouldRouteGuestOutboundViaWhapiSuites, isStageEffectivelyActive } from "./guestWhapiRouting.ts";

function withWhapiFlag(enabled: boolean, fn: () => void) {
  const prev = Deno.env.get("GUEST_WHAPI_SUITES_ENABLED");
  if (enabled) Deno.env.set("GUEST_WHAPI_SUITES_ENABLED", "true");
  else Deno.env.delete("GUEST_WHAPI_SUITES_ENABLED");
  try {
    fn();
  } finally {
    if (prev === undefined) Deno.env.delete("GUEST_WHAPI_SUITES_ENABLED");
    else Deno.env.set("GUEST_WHAPI_SUITES_ENABLED", prev);
  }
}

Deno.test("suite guest, weekday arrival, dispatch_channel=meta, flag on → Whapi path", () => {
  withWhapiFlag(true, () => {
    const guest = { room: "אמטיסט 8", room_type: "suite", dispatch_channel: "meta" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), true);
  });
});

Deno.test("suite guest, flag off → Meta path (feature inert)", () => {
  withWhapiFlag(false, () => {
    const guest = { room: "אמטיסט 8", room_type: "suite", dispatch_channel: "whapi" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("day-pass guest, any trigger, flag on → Meta path, never Whapi", () => {
  withWhapiFlag(true, () => {
    const guest = { room: null, room_type: "day_guest", dispatch_channel: "whapi" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("suite-room guest mis-tagged day_guest (room_type conflict) → still routes Whapi (effective suite)", () => {
  withWhapiFlag(true, () => {
    const guest = { room: "אמטיסט 8", room_type: "day_guest" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=true stage is active for anyone, flag off", () => {
  withWhapiFlag(false, () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + Meta-only (day-pass) guest stays paused", () => {
  withWhapiFlag(true, () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + suite guest, flag off (feature inert) stays paused", () => {
  withWhapiFlag(false, () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + Whapi-eligible suite guest bypasses the Meta-template pause", () => {
  withWhapiFlag(true, () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + no guest context (event-immediate stages) stays paused", () => {
  withWhapiFlag(true, () => {
    assertEquals(isStageEffectivelyActive({ is_active: false }, null), false);
  });
});
