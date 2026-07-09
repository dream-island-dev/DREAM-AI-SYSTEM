// supabase/functions/_shared/guestWhapiRouting.ts
//
// Single source of truth for "should this guest's manual outbound message go
// out through Whapi instead of Meta Cloud API?" (Phase 1 of the guest-outbound
// Whapi rollout — see CLAUDE.md / project memory
// project-whapi-guest-outbound-rollout).
//
// Uses the ALREADY-CONNECTED Whapi device (the same WHAPI_TOKEN channel that
// today handles the internal staff-ops group) — not a separate token/device.
// Gated on a single master switch so the feature stays inert (falls through
// to today's Meta-only behavior) until explicitly turned on:
//   npx supabase secrets set GUEST_WHAPI_SUITES_ENABLED=true
//
// ⚠️ Because this reuses the staff-ops device, guest replies land in the same
// WhatsApp number already used for team task cards/DMs. Inbound handling for
// guest replies on that device is a SEPARATE piece of work (whapi-webhook's
// current message loop ignores anything that isn't a group chat — see its
// "not_a_group" guard) — not covered by this file, which is outbound-only.

import { isEffectiveSuiteGuest, GuestRoomFields } from "./suiteNames.ts";
import { isGuestActiveForOutbound } from "./guestOutboundGuard.ts";

export function isGuestWhapiSuitesEnabled(): boolean {
  return Deno.env.get("GUEST_WHAPI_SUITES_ENABLED") === "true";
}

/** Effective suite guest AND feature enabled — the one call sites should use. */
export function shouldRouteGuestOutboundViaWhapiSuites(
  guest: GuestRoomFields | null | undefined,
): boolean {
  return isGuestWhapiSuitesEnabled() && isEffectiveSuiteGuest(guest);
}

/**
 * Auto-reply eligibility for an INBOUND Suites-device guest DM
 * (whapi-webhook's handleGuestDirectMessage) — deliberately broader than
 * shouldRouteGuestOutboundViaWhapiSuites() above.
 *
 * That function answers "which channel should WE pick to send to this
 * guest" (an OUTBOUND routing decision, which must stay narrow — suite vs
 * day-pass content genuinely differs). This one answers "did a real, active
 * guest just message a device we operate" — a guest who successfully DMs the
 * Suites number has already proven they can reach it; gating the reply on
 * isEffectiveSuiteGuest (room/room_type) additionally means a guest with no
 * room assigned yet (e.g. arriving tomorrow, pre check-in) gets silence
 * instead of a reply. Any guest whose profile isn't cancelled/checked_out
 * qualifies — same "active" bar guestOutboundGuard.ts uses everywhere else.
 */
export function shouldAutoReplyGuestWhapiDm(
  guest: { status?: string | null } | null | undefined,
): boolean {
  return isGuestWhapiSuitesEnabled() && isGuestActiveForOutbound(guest);
}
