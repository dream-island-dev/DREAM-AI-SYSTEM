import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES,
  isGuestBotConversationDisabled,
  isGuestStaffClaimActive,
  isStaffClaimTimestampExpired,
  minutesUntilStaffClaimRelease,
  parseInboxClaimIdleReleaseMinutes,
} from "./guestStaffClaim.ts";

const NOW = new Date("2026-07-19T12:00:00.000Z");

Deno.test("parseInboxClaimIdleReleaseMinutes — default and bounds", () => {
  assertEquals(parseInboxClaimIdleReleaseMinutes({}), DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES);
  assertEquals(parseInboxClaimIdleReleaseMinutes({ inbox_claim_idle_release_minutes: "90" }), 90);
  assertEquals(parseInboxClaimIdleReleaseMinutes({ inbox_claim_idle_release_minutes: "2" }), 60);
  assertEquals(parseInboxClaimIdleReleaseMinutes({ inbox_claim_idle_release_minutes: "9999" }), 24 * 60);
});

Deno.test("isGuestBotConversationDisabled — guest_profile.inbox.bot_disabled", () => {
  assertEquals(isGuestBotConversationDisabled(null), false);
  assertEquals(isGuestBotConversationDisabled({ guest_profile: { inbox: { bot_disabled: true } } }), true);
  assertEquals(isGuestBotConversationDisabled({ guest_profile: { inbox: { bot_disabled: false } } }), false);
});

Deno.test("isGuestStaffClaimActive — expired claim is inactive", () => {
  const guest = {
    claimed_by: "staff-1",
    claimed_at: "2026-07-19T10:00:00.000Z",
  };
  assertEquals(
    isGuestStaffClaimActive(guest, "meta", { now: NOW, idleReleaseMinutes: 60 }),
    false,
  );
});

Deno.test("isGuestStaffClaimActive — fresh claim is active", () => {
  const guest = {
    claimed_by: "staff-1",
    claimed_at: "2026-07-19T11:30:00.000Z",
  };
  assertEquals(
    isGuestStaffClaimActive(guest, "meta", { now: NOW, idleReleaseMinutes: 60 }),
    true,
  );
});

Deno.test("isGuestStaffClaimActive — bot_disabled without claim", () => {
  assertEquals(
    isGuestStaffClaimActive({ guest_profile: { inbox: { bot_disabled: true } } }, "meta"),
    true,
  );
});

Deno.test("isGuestStaffClaimActive — whapi channel uses whapi fields", () => {
  assertEquals(
    isGuestStaffClaimActive(
      { claimed_by_whapi: "w1", claimed_at_whapi: "2026-07-19T11:30:00.000Z" },
      "whapi",
      { now: NOW, idleReleaseMinutes: 60 },
    ),
    true,
  );
  assertEquals(
    isGuestStaffClaimActive({ claimed_by: "meta-only", claimed_at: "2026-07-19T11:30:00.000Z" }, "whapi"),
    false,
  );
});

Deno.test("minutesUntilStaffClaimRelease", () => {
  assertEquals(
    minutesUntilStaffClaimRelease("2026-07-19T11:30:00.000Z", NOW, 60),
    30,
  );
  assertEquals(
    minutesUntilStaffClaimRelease("2026-07-19T10:00:00.000Z", NOW, 60),
    null,
  );
});

Deno.test("isStaffClaimTimestampExpired — missing claimed_at treated expired", () => {
  assertEquals(isStaffClaimTimestampExpired(null, NOW, 60), true);
  assertEquals(isStaffClaimTimestampExpired("bad", NOW, 60), true);
});
