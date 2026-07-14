// supabase/functions/_shared/guestWhapiRouting.test.ts
//
// Run: deno test --allow-env supabase/functions/_shared/guestWhapiRouting.test.ts
//
// shouldRouteGuestOutboundViaWhapiSuites is the single gate whatsapp-send's
// shouldUseWhapiForGuestAutomation() now wraps directly. Suite and day-pass
// guests each follow their OWN independent bot_config-backed channel (P0,
// 2026-07-13) — this replaced the single GUEST_WHAPI_SUITES_ENABLED gate for
// routing decisions, so these tests drive the module's channel cache via
// __setGuestChannelsForTest instead of the old env var.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  shouldRouteGuestOutboundViaWhapiSuites,
  isStageEffectivelyActive,
  isMetaGuestTemplateAllowed,
  isGuestWhapiSuitesEnabled,
  isWhapiGuestSosActive,
  shouldAutoReplyGuestWhapiDm,
  __setGuestChannelsForTest,
  __setWhapiFailoverForTest,
} from "./guestWhapiRouting.ts";

type SuitesChannel = "whapi" | "meta";
type DaypassChannel = "off" | "whapi" | "meta";

function withChannels(suites: SuitesChannel, daypass: DaypassChannel, fn: () => void) {
  __setGuestChannelsForTest(suites, daypass);
  try {
    fn();
  } finally {
    __setGuestChannelsForTest("meta", "off"); // restore module defaults
    __setWhapiFailoverForTest({ sosManual: false, autoFailover: true, deviceHealthy: null });
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

// ── Cohort-aware channel routing (P0, 2026-07-13) ──────────────────────────

Deno.test("suite guest routes Whapi when guest_suites_channel=whapi, independent of day-pass channel", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), true);
  });
});

Deno.test("suite guest routes Meta when guest_suites_channel=meta (DreamBot)", () => {
  withChannels("meta", "whapi", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("day-pass guest never routes Whapi (migration 205 — spa/day-pass Meta only)", () => {
  withChannels("meta", "whapi", () => {
    const guest = { room: "Premium Day 1", room_type: "day_guest" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("day-pass guest routes Meta when guest_daypass_channel=meta", () => {
  withChannels("whapi", "meta", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("day-pass guest routes Meta (falls through) when guest_daypass_channel=off", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
  });
});

Deno.test("suite-room guest mis-tagged day_guest (room_type conflict) → still routes by suite channel (effective suite)", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "day_guest" };
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), true);
  });
});

Deno.test("shouldRouteGuestOutboundViaWhapiSuites: no guest context → false regardless of channels", () => {
  withChannels("whapi", "whapi", () => {
    assertEquals(shouldRouteGuestOutboundViaWhapiSuites(null), false);
  });
});

// ── isStageEffectivelyActive ────────────────────────────────────────────────

Deno.test("isStageEffectivelyActive: is_active=true stage is active for anyone, channels off/meta", () => {
  withChannels("meta", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + day-pass guest never Whapi-bypasses (migration 205)", () => {
  withChannels("meta", "whapi", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + day-pass guest, daypass=meta stays paused (no Whapi bypass, Meta not approved)", () => {
  withChannels("meta", "meta", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + suite guest, suites=meta (feature off for suites) stays paused", () => {
  withChannels("meta", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + Whapi-eligible suite guest bypasses the Meta-template pause", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: false }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: is_active=false + no guest context (event-immediate stages) stays paused", () => {
  withChannels("whapi", "whapi", () => {
    assertEquals(isStageEffectivelyActive({ is_active: false }, null), false);
  });
});

// ── Day-pass hard OFF (P0, 2026-07-13) — real kill switch, not just "no Whapi" ──

Deno.test("isStageEffectivelyActive: daypass=off HARD-BLOCKS a day-pass guest even when is_active=true", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), false);
  });
});

Deno.test("isStageEffectivelyActive: daypass=off does NOT affect suite guests on the same stage", () => {
  withChannels("whapi", "off", () => {
    const guest = { room: "אמטיסט 8", room_type: "suite" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: daypass=whapi does NOT hard-block — normal OR logic applies", () => {
  withChannels("meta", "whapi", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), true);
  });
});

Deno.test("isStageEffectivelyActive: daypass=meta does NOT hard-block — normal OR logic applies", () => {
  withChannels("whapi", "meta", () => {
    const guest = { room: null, room_type: "day_guest" };
    assertEquals(isStageEffectivelyActive({ is_active: true }, guest), true);
  });
});

// ── isMetaGuestTemplateAllowed ───────────────────────────────────────────────

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

Deno.test("isWhapiGuestSosActive: bot_config manual SOS without env secret", () => {
  withSos(false, () => {
    __setWhapiFailoverForTest({ sosManual: true, deviceHealthy: true });
    assertEquals(isWhapiGuestSosActive(), true);
  });
});

Deno.test("isWhapiGuestSosActive: auto-failover when device unhealthy", () => {
  withSos(false, () => {
    __setWhapiFailoverForTest({ sosManual: false, autoFailover: true, deviceHealthy: false });
    assertEquals(isWhapiGuestSosActive(), true);
  });
});

Deno.test("isWhapiGuestSosActive: unknown device health does not auto-failover", () => {
  withSos(false, () => {
    __setWhapiFailoverForTest({ sosManual: false, autoFailover: true, deviceHealthy: null });
    assertEquals(isWhapiGuestSosActive(), false);
  });
});

// ── P0 SOS (2026-07-13, WHAPI_GUEST_SOS_META) — full routing matrix ─────────
// SOS must win over EVERY channel setting, for both cohorts.

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

Deno.test("isGuestWhapiSuitesEnabled: SOS on overrides guest_suites_channel=whapi", () => {
  withSos(true, () => {
    withChannels("whapi", "off", () => {
      assertEquals(isGuestWhapiSuitesEnabled(), false);
    });
  });
});

Deno.test("isGuestWhapiSuitesEnabled: SOS off + suites=whapi is unaffected", () => {
  withSos(false, () => {
    withChannels("whapi", "off", () => {
      assertEquals(isGuestWhapiSuitesEnabled(), true);
    });
  });
});

Deno.test("shouldRouteGuestOutboundViaWhapiSuites: SOS on sends a suite guest back to Meta even with suites=whapi", () => {
  withSos(true, () => {
    withChannels("whapi", "whapi", () => {
      const guest = { room: "אמטיסט 8", room_type: "suite" };
      assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
    });
  });
});

Deno.test("shouldRouteGuestOutboundViaWhapiSuites: SOS on sends a day-pass guest back to Meta even with daypass=whapi", () => {
  withSos(true, () => {
    withChannels("whapi", "whapi", () => {
      const guest = { room: "Premium Day 1", room_type: "day_guest" };
      assertEquals(shouldRouteGuestOutboundViaWhapiSuites(guest), false);
    });
  });
});

// room_ready (whatsapp-send/index.ts) reads isGuestWhapiSuitesEnabled()
// directly rather than going through shouldRouteGuestOutboundViaWhapiSuites —
// this is the exact case the P0 SOS work required covering without a
// per-caller edit, still true after the cohort-channel refactor.
Deno.test("isGuestWhapiSuitesEnabled: SOS on covers the room_ready direct-read path too", () => {
  withSos(true, () => {
    withChannels("whapi", "off", () => {
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
    withChannels("whapi", "off", () => {
      const guest = { status: "checked_in" };
      assertEquals(shouldAutoReplyGuestWhapiDm(guest), false);
    });
  });
});

Deno.test("shouldAutoReplyGuestWhapiDm: SOS off + suites=whapi allows the auto-reply for an active guest", () => {
  withSos(false, () => {
    withChannels("whapi", "off", () => {
      const guest = { status: "checked_in" };
      assertEquals(shouldAutoReplyGuestWhapiDm(guest), true);
    });
  });
});
