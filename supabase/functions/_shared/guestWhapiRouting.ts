// supabase/functions/_shared/guestWhapiRouting.ts
//
// Single source of truth for "should this guest's manual outbound message go
// out through Whapi instead of Meta Cloud API?" (Phase 1 of the guest-outbound
// Whapi rollout — see CLAUDE.md / project memory
// project-whapi-guest-outbound-rollout).
//
// Uses the ALREADY-CONNECTED Whapi device (the same WHAPI_TOKEN channel that
// today handles the internal staff-ops group) — not a separate token/device.
// Gated per-cohort (P0, 2026-07-13) via bot_config rows editable from ACC —
// "guest_suites_channel" (whapi|meta) and "guest_daypass_channel"
// (off|whapi|meta) — see primeGuestChannelConfig below. The old single env
// flag GUEST_WHAPI_SUITES_ENABLED is no longer read by routing decisions in
// this file; it is left in place only as historical/emergency context.
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
import { fetchGuestBotConfig } from "./guestBotSettings.ts";

/**
 * Per-cohort channel control (P0, 2026-07-13) — replaces the single global
 * GUEST_WHAPI_SUITES_ENABLED gate for routing decisions with two independent
 * ACC-editable settings stored as bot_config rows (same KV table as
 * bot_active/bot_active_whapi — no new table): "guest_suites_channel"
 * (whapi|meta) and "guest_daypass_channel" (off|whapi|meta). Defaults below
 * match Mike's lock (Suites=DreamBot, Day-pass=Off) so any caller that never
 * primes the cache — or a cold isolate before its first prime — degrades to
 * the safe/conservative choice, not a silent Whapi send.
 *
 * Callers MUST `await primeGuestChannelConfig(supabase)` once near the top
 * of their handler, before any of the routing functions below run. Priming
 * is cheap to call repeatedly — it just delegates to fetchGuestBotConfig's
 * own 5-minute TTL cache — so a shared helper (e.g. guestInboundOrchestrator)
 * priming again after its caller already did is not a real extra DB hit.
 */
type SuitesChannel = "whapi" | "meta";
type DaypassChannel = "off" | "whapi" | "meta";

let _suitesChannel: SuitesChannel = "meta";
let _daypassChannel: DaypassChannel = "off";

// deno-lint-ignore no-explicit-any
export async function primeGuestChannelConfig(supabase: any): Promise<void> {
  const cfg = await fetchGuestBotConfig(supabase);
  _suitesChannel = cfg["guest_suites_channel"] === "whapi" ? "whapi" : "meta";
  const dp = cfg["guest_daypass_channel"];
  _daypassChannel = dp === "whapi" ? "whapi" : dp === "meta" ? "meta" : "off";
}

/** Read-only accessors for callers that need to display current state (ACC systemStatus). */
export function getGuestSuitesChannel(): SuitesChannel { return _suitesChannel; }
export function getGuestDaypassChannel(): DaypassChannel { return _daypassChannel; }

/**
 * Test-only synchronous override — lets Deno tests set the cache directly
 * instead of mocking a Supabase client + fetchGuestBotConfig just to reach
 * primeGuestChannelConfig. Not called anywhere outside *.test.ts.
 */
export function __setGuestChannelsForTest(suites: SuitesChannel, daypass: DaypassChannel): void {
  _suitesChannel = suites;
  _daypassChannel = daypass;
}

/**
 * SOS kill-switch (P0, 2026-07-13) — WhatsApp put the Suites device on a
 * ~17h restriction (suspected automated-message/spam flag) after a
 * retry-storm; the Whapi channel itself also showed QR/disconnected. While
 * this is set, EVERY guest-outbound decision that would otherwise pick the
 * Suites Whapi device falls back to Meta Dream Bot instead — independent of
 * GUEST_WHAPI_SUITES_ENABLED, which is left untouched so it keeps recording
 * the standing intent ("we want Whapi-first for suites/day-pass") separately
 * from this temporary transport outage. Mike flips ONE flag either way:
 *   npx supabase secrets set WHAPI_GUEST_SOS_META=true      # activate SOS
 *   npx supabase secrets unset WHAPI_GUEST_SOS_META         # restore Whapi-first
 * Does NOT fix the housekeeping-group observer (N✅ / checkin / checkout
 * acks) — that is INBOUND on the same banned device with no Meta substitute;
 * it stays broken until the device itself is unbanned + reconnected.
 */
export function isWhapiGuestSosActive(): boolean {
  return Deno.env.get("WHAPI_GUEST_SOS_META") === "true";
}

/**
 * SOS check lives here (not scattered at call sites) so every one of this
 * function's ~10 callers — including room_ready, which reads this directly
 * rather than through shouldRouteGuestOutboundViaWhapiSuites — automatically
 * falls back to Meta the instant SOS is active, with no per-caller changes.
 *
 * Suites-specific: room_ready and the other standalone (non-guest) callers
 * of this function are historically suite-only contexts, so this maps to
 * the Suites cohort channel. Day-pass has its own independent channel value
 * — see shouldRouteGuestOutboundViaWhapiSuites, which is cohort-aware.
 */
export function isGuestWhapiSuitesEnabled(): boolean {
  if (isWhapiGuestSosActive()) return false;
  return _suitesChannel === "whapi";
}

/**
 * Guest outbound via Suites Whapi device (not Meta templates) — cohort-aware
 * (P0, 2026-07-13): suite guests follow guest_suites_channel, day-pass guests
 * follow guest_daypass_channel independently. Content still comes from
 * stage-specific bot_scripts (night_before_daypass, morning_daypass, …);
 * this gate only picks the transport.
 */
export function shouldRouteGuestOutboundViaWhapiSuites(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (isWhapiGuestSosActive() || !guest) return false;
  if (isEffectiveSuiteGuest(guest)) return _suitesChannel === "whapi";
  if (isEffectiveDayPassGuest(guest)) return _daypassChannel === "whapi";
  return false;
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
 * Day-pass hard mute (P0, 2026-07-13): guest_daypass_channel="off" is a real
 * kill switch, not just "don't use Whapi" — it must block day-pass guests
 * even on stages where is_active happens to be true (Meta path), because
 * "Off" means no automated day-pass outbound at all until Mike re-enables
 * it. This check runs before the is_active OR-clause so it can't be bypassed
 * by a stage that was independently left/flipped active. Manual Override
 * (force=true at every call site below) is untouched — Disable-Don't-Hide
 * still applies to the scheduled/automatic path only.
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
  if (isEffectiveDayPassGuest(guest) && _daypassChannel === "off") return false;
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
  // SOS implies Meta IS the sanctioned path for Whapi-eligible guests — don't
  // make staff also flip ALLOW_META_GUEST_TEMPLATES by hand during an outage.
  if (isWhapiGuestSosActive()) return true;
  return Deno.env.get("ALLOW_META_GUEST_TEMPLATES") === "true";
}

/**
 * FAIL VISIBLE reason text for a Whapi-eligible action currently refused —
 * distinguishes "SOS emergency active" from "feature simply never turned on"
 * so a staff member troubleshooting mid-incident isn't misled into hunting
 * for the wrong secret. Callers prefix this with their own status/error code.
 */
export function whapiDisabledReasonHe(): string {
  if (isWhapiGuestSosActive()) {
    return "🚨 מצב חירום Meta פעיל (WHAPI_GUEST_SOS_META) — מכשיר הסוויטות מושבת זמנית עקב הגבלת וואטסאפ. " +
      "שליחה ידנית דרך Whapi חסומה כרגע — יש להשתמש ב-Meta Template.";
  }
  return "ערוץ Whapi נבחר אך אינו מופעל כרגע (הגדרת ערוץ ב-ACC) — ההודעה לא נשלחה.";
}
