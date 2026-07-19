/** Mirrors supabase/functions/_shared/guestStaffClaim.ts (frontend can't import Deno). */

export const INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY = "inbox_claim_idle_release_minutes";
export const DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES = 60;

export function parseInboxClaimIdleReleaseMinutes(cfgMap = {}) {
  const raw = cfgMap[INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY];
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 5) return DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES;
  if (n > 24 * 60) return 24 * 60;
  return n;
}

export function isGuestBotConversationDisabled(guest) {
  const inbox = guest?.guest_profile?.inbox;
  return inbox?.bot_disabled === true;
}

function isStaffClaimTimestampExpired(claimedAt, now, idleMinutes) {
  if (claimedAt == null || claimedAt === "") return true;
  const ts = new Date(String(claimedAt)).getTime();
  if (!Number.isFinite(ts)) return true;
  return now.getTime() - ts > idleMinutes * 60_000;
}

/** True when bot is muted for this guest/channel (pinned off or active non-expired claim). */
export function isGuestStaffClaimEffectivelyActive(guest, channel = "meta", opts = {}) {
  if (isGuestBotConversationDisabled(guest)) return true;
  const claimedBy = channel === "whapi"
    ? (guest?.claimed_by_whapi ?? guest?.whapiClaimedBy)
    : (guest?.claimed_by ?? guest?.claimedBy);
  if (claimedBy == null || claimedBy === "") return false;
  const claimedAt = channel === "whapi"
    ? (guest?.claimed_at_whapi ?? guest?.whapiClaimedAt ?? guest?.claimedAt)
    : (guest?.claimed_at ?? guest?.claimedAt);
  const idleMinutes = opts.idleReleaseMinutes ?? DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES;
  const now = opts.now ?? new Date();
  return !isStaffClaimTimestampExpired(claimedAt, now, idleMinutes);
}

export function minutesUntilStaffClaimRelease(claimedAt, now, idleMinutes) {
  if (claimedAt == null || claimedAt === "") return null;
  const ts = new Date(String(claimedAt)).getTime();
  if (!Number.isFinite(ts)) return null;
  const remainingMs = ts + idleMinutes * 60_000 - now.getTime();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / 60_000);
}

export function mergeGuestProfileBotDisabled(guestProfile, disabled) {
  const base = guestProfile && typeof guestProfile === "object" && !Array.isArray(guestProfile)
    ? { ...guestProfile }
    : {};
  const inbox = base.inbox && typeof base.inbox === "object" && !Array.isArray(base.inbox)
    ? { ...base.inbox }
    : {};
  if (disabled) inbox.bot_disabled = true;
  else delete inbox.bot_disabled;
  if (Object.keys(inbox).length > 0) base.inbox = inbox;
  else delete base.inbox;
  return base;
}
