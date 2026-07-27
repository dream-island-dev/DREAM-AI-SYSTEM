import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  isPastIsraelLocalTime,
  normalizeGuestClubWaSettings,
  shouldOfferClubInPortal,
  shouldOfferClubViaWa,
} from "./guestClubWaSettings.ts";

Deno.test("normalizeGuestClubWaSettings defaults", () => {
  const s = normalizeGuestClubWaSettings(null);
  assertEquals(s.wa_invite_enabled, true);
  assertEquals(s.portal_offer_enabled, true);
  assertEquals(s.departure_fallback_time, "19:00");
});

Deno.test("shouldOfferClubViaWa respects wa_invite_enabled", () => {
  const s = normalizeGuestClubWaSettings({ wa_invite_enabled: false });
  assertEquals(shouldOfferClubViaWa(s), false);
  assertEquals(shouldOfferClubInPortal(s), true);
});

Deno.test("shouldOfferClubInPortal respects portal_offer_enabled opt-out", () => {
  const s = normalizeGuestClubWaSettings({ portal_offer_enabled: false });
  assertEquals(shouldOfferClubInPortal(s), false);
});

Deno.test("isPastIsraelLocalTime compares HH:MM", () => {
  const late = new Date("2026-07-26T16:30:00.000Z"); // ~19:30 Israel summer
  assertEquals(isPastIsraelLocalTime(late, "19:00"), true);
  assertEquals(isPastIsraelLocalTime(late, "21:00"), false);
});
