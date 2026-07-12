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

import {
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
  GuestRoomFields,
} from "./suiteNames.ts";
import { isGuestActiveForOutbound } from "./guestOutboundGuard.ts";

export function isGuestWhapiSuitesEnabled(): boolean {
  return Deno.env.get("GUEST_WHAPI_SUITES_ENABLED") === "true";
}

/**
 * Guest outbound via Suites Whapi device (not Meta templates) when the master
 * flag is on. Covers effective suite AND day-pass guests — day-pass previously
 * stayed on Meta and hit broken templates (e.g. dream_checkin_reminder_v2
 * #131008 URL button / #132000 body params) in a cron retry loop.
 * Content still comes from stage-specific bot_scripts (night_before_daypass,
 * morning_daypass, …); this gate only picks the transport.
 */
export function shouldRouteGuestOutboundViaWhapiSuites(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!isGuestWhapiSuitesEnabled() || !guest) return false;
  return isEffectiveSuiteGuest(guest) || isEffectiveDayPassGuest(guest);
}

/**
 * automation_stages.is_active has, in every documented case so far (see
 * docs/active_sprint.md "Blocked — Action Required"), meant "is this stage's
 * Meta template approved/cleared" — night_before / morning_suite get paused
 * with is_active=false while waiting on Meta Business Manager, nothing else.
 * Whapi's free-text session path never needs Meta template approval, so a
 * stage paused only for that reason must still reach Whapi-eligible guests
 * (suite + day-pass). Meta-only guests (flag off) stay paused.
 *
 * Single source of truth for this decision — whatsapp-cron (due-item scan),
 * automation-queue (ACC Live Queue projection), and whatsapp-send (actual
 * dispatch gate) must all agree, or a stage can appear due in one place and
 * silently refuse to send in another (the exact class of bug the 2026-07-12
 * Stage 1 Whapi incident already came from).
 */
export function isStageEffectivelyActive(
  stage: { is_active: boolean },
  guest: GuestRoomFields | null | undefined,
): boolean {
  return stage.is_active === true || shouldRouteGuestOutboundViaWhapiSuites(guest);
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

/**
 * Phase 3 hard-fail escape hatch (2026-07-13) — ACC's Override still keeps
 * "🔵 Meta Template" clickable-not-disabled for Whapi-eligible guests (a
 * legitimate fallback when the physical Suites device is down), so this must
 * stay an explicit opt-in, not a permanent block. Default false: a staff
 * force_channel="meta_template" on a Whapi-eligible guest is refused
 * (FAIL VISIBLE) unless someone deliberately sets this secret.
 *   npx supabase secrets set ALLOW_META_GUEST_TEMPLATES=true
 */
export function isMetaGuestTemplateAllowed(): boolean {
  return Deno.env.get("ALLOW_META_GUEST_TEMPLATES") === "true";
}
