// supabase/functions/_shared/guestWhapiRouting.test.ts
//
// Run: deno test --allow-env supabase/functions/_shared/guestWhapiRouting.test.ts
//
// shouldRouteGuestOutboundViaWhapiSuites is the single gate whatsapp-send's
// shouldUseWhapiForGuestAutomation() now wraps directly (2026-07-10 — the
// dispatch_channel and Shabbat-only gates were removed; 2026-07-12 day-pass
// included). Suite + day-pass guests route to Whapi once the flag is on.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  shouldRouteGuestOutboundViaWhapiSuites,
  isStageEffectivelyActive,
  isMetaGuestTemplateAllowed,
  isGuestWhapiSuitesEnabled,
  isWhapiGuestSosActive,
  shouldAutoReplyGuestWhapiDm,
} from "./guestWhapiRouting.ts";

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

function withSos(active: boolean, fn: () => void) {
  const prev = Deno.env.get("WHAPI_GUEST_SOS_META");
  if (active) Deno.env.set("WHAPI_GUEST_SOS_META", "true");
  else Deno.env.delete("WHAPI_GUEST_SOS_META");
  try {
    fn();
  } finally {
    if (prev === undefined) Deno.env.delete("WHAPI_GUEST_SOS_META");
    else Deno.env.set("WHAPI_GUEST_SOS_META", prev);
  }
}

function withMetaGuestTemplatesAllowed(enabled: boolean, fn: () => void) {
  const prev = Deno.env.get("ALLOW_META_GUEST_TEMPLATES");
  if (enabled) Deno.env.set("ALLOW_META_GUEST_TEMPLATES", "true");
  else Deno.env.delete("ALLOW_META_GUEST_TEMPLATES");
  try {
    fn();
  } finally {
    if (prev === undefined) Deno.env.delete("ALLOW_META_GUEST_TEMPLATES");
    else Deno.env.set("ALLOW_META_GUEST_TEMPLATES", prev);
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

Deno.test("day-pass guest, flag on → Whapi path (same transport as suites)", () => {
  withWhapiFlag(true, () => {
    const guest = { room: "Premium Day 1", room_type: "day_guest", dispatch_channel: "meta" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), true);
  });
});

Deno.test("day-pass guest, flag off → Meta path (feature inert)", () => {
  withWhapiFlag(false, () => {
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

Deno.test("isStageEffectivelyActive: is_active=false + day-pass guest, flag on bypasses Meta-template pause", () => {
  withWhapiFlag(true, () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + day-pass guest, flag off stays paused", () => {
  withWhapiFlag(false, () => {
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

Deno.test("isMetaGuestTemplateAllowed: false by default (secret unset)", () => {
  withMetaGuestTemplatesAllowed(false, () => {
    assertEquals(isMetaGuestTemplateAllowed(), false);
  });
});

Deno.test("isMetaGuestTemplateAllowed: true only when the escape-hatch secret is explicitly set", () => {
  withMetaGuestTemplatesAllowed(true, () => {
    assertEquals(isMetaGuestTemplateAllowed(), true);
  });
});

// ── P0 SOS (2026-07-13, WHAPI_GUEST_SOS_META) — full routing matrix ──

Deno.test("isWhapiGuestSosActive: false by default", () => {
  withSos(false, () => {
    assertEquals(isWhapiGuestSosActive(), false);
  });
});

Deno.test("isWhapiGuestSosActive: true only when the SOS secret is explicitly set", () => {
  withSos(true, () => {
    assertEquals(isWhapiGuestSosActive(), true);
  });
});

Deno.test("isGuestWhapiSuitesEnabled: SOS on overrides GUEST_WHAPI_SUITES_ENABLED=true", () => {
  withSos(true, () => {
    withWhapiFlag(true, () => {
      assertEquals(isGuestWhapiSuitesEnabled(), false);
    });
  });
});

Deno.test("isGuestWhapiSuitesEnabled: SOS on + flag off stays false (no change)", () => {
  withSos(true, () => {
    withWhapiFlag(false, () => {
      assertEquals(isGuestWhapiSuitesEnabled(), false);
    });
  });
});

Deno.test("isGuestWhapiSuitesEnabled: SOS off + flag on is unaffected (pre-P0 behavior preserved)", () => {
  withSos(false, () => {
    withWhapiFlag(true, () => {
      assertEquals(isGuestWhapiSuitesEnabled(), true);
    });
  });
});

Deno.test("shouldRouteGuestOutboundViaWhapiSuites: SOS on sends a suite guest back to Meta even with flag on", () => {
  withSos(true, () => {
    withWhapiFlag(true, () => {
      const guest = { room: "אמטיסט 8", room_type: "suite" };
      assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
    });
  });
});

Deno.test("shouldRouteGuestOutboundViaWhapiSuites: SOS on sends a day-pass guest back to Meta even with flag on", () => {
  withSos(true, () => {
    withWhapiFlag(true, () => {
      const guest = { room: "Premium Day 1", room_type: "day_guest" };
      assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
    });
  });
});

// room_ready (whatsapp-send/index.ts) reads isGuestWhapiSuitesEnabled()
// directly rather than going through shouldRouteGuestOutboundViaWhapiSuites —
// this is the exact case the P0 required covering without a per-caller edit.
Deno.test("isGuestWhapiSuitesEnabled: SOS on covers the room_ready direct-read path too", () => {
  withSos(true, () => {
    withWhapiFlag(true, () => {
      const useWhapiForRoomReady = isGuestWhapiSuitesEnabled();
      assertEquals(useWhapiForRoomReady, false);
    });
  });
});

Deno.test("isMetaGuestTemplateAllowed: SOS on auto-allows Meta templates even without the escape-hatch secret", () => {
  withSos(true, () => {
    withMetaGuestTemplatesAllowed(false, () => {
      assertEquals(isMetaGuestTemplateAllowed(), true);
    });
  });
});

Deno.test("shouldAutoReplyGuestWhapiDm: SOS on silences the Whapi DM auto-reply even for an active guest", () => {
  withSos(true, () => {
    withWhapiFlag(true, () => {
      const guest = { status: "checked_in" };
      assertEquals(shouldAutoReplyGuestWhapiDm(guest), false);
    });
  });
});
