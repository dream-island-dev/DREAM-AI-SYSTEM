// supabase/functions/_shared/guestWhapiRouting.ts
//
// Single source of truth for "should this guest's manual outbound message go
// out through the Suites Whapi device instead of Meta Cloud API?" (Phase 1 of
// the guest-outbound Whapi rollout — see CLAUDE.md / project memory
// project-whapi-guest-outbound-rollout).
//
// Double-gated on purpose: both a master switch AND a token secret must be
// set for the feature to activate. This means the code is 100% inert (falls
// through to today's Meta-only behavior) the moment either is missing — safe
// to deploy before the physical Suites device is even connected to Whapi.
//
// Deploy this first, ship it OFF; Mike flips it on later with:
//   npx supabase secrets set WHAPI_SUITES_TOKEN=<token from Whapi dashboard>
//   npx supabase secrets set GUEST_WHAPI_SUITES_ENABLED=true

import { isEffectiveSuiteGuest, GuestRoomFields } from "./suiteNames.ts";

export function isGuestWhapiSuitesEnabled(): boolean {
  return (
    Deno.env.get("GUEST_WHAPI_SUITES_ENABLED") === "true" &&
    !!Deno.env.get("WHAPI_SUITES_TOKEN")
  );
}

/** Effective suite guest AND feature enabled — the one call sites should use. */
export function shouldRouteGuestOutboundViaWhapiSuites(
  guest: GuestRoomFields | null | undefined,
): boolean {
  return isGuestWhapiSuitesEnabled() && isEffectiveSuiteGuest(guest);
}
