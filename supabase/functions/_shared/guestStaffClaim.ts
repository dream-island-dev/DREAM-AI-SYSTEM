// Per-guest staff claim mute — idle auto-release + pinned bot_disabled override.
// Claim (claimed_by) mutes conversational bot replies; TTL resets on thread activity.

export const INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY = "inbox_claim_idle_release_minutes";
export const DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES = 60;

export type StaffClaimGuestRow = {
  claimed_by?: unknown;
  claimed_at?: unknown;
  claimed_by_whapi?: unknown;
  claimed_at_whapi?: unknown;
  guest_profile?: unknown;
};

export function parseInboxClaimIdleReleaseMinutes(
  botConfig: Record<string, string> | null | undefined,
): number {
  const raw = botConfig?.[INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY];
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 5) return DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES;
  if (n > 24 * 60) return 24 * 60;
  return n;
}

/** Staff pinned this guest's conversational bot off (separate from automation_muted). */
export function isGuestBotConversationDisabled(
  guest: { guest_profile?: unknown } | null | undefined,
): boolean {
  const profile = guest?.guest_profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const inbox = (profile as Record<string, unknown>).inbox;
  if (!inbox || typeof inbox !== "object" || Array.isArray(inbox)) return false;
  return (inbox as Record<string, unknown>).bot_disabled === true;
}

export function isStaffClaimTimestampExpired(
  claimedAt: unknown,
  now: Date,
  idleMinutes: number,
): boolean {
  if (claimedAt == null || claimedAt === "") return true;
  const ts = new Date(String(claimedAt)).getTime();
  if (!Number.isFinite(ts)) return true;
  return now.getTime() - ts > idleMinutes * 60_000;
}

/**
 * True when the conversational bot must stay silent for this guest/channel:
 * pinned bot_disabled OR a non-expired staff claim on that channel.
 */
export function isGuestStaffClaimActive(
  guest: StaffClaimGuestRow | null | undefined,
  channel: "meta" | "whapi" = "meta",
  opts?: { now?: Date; idleReleaseMinutes?: number },
): boolean {
  if (isGuestBotConversationDisabled(guest)) return true;
  const val = channel === "whapi" ? guest?.claimed_by_whapi : guest?.claimed_by;
  if (val == null || val === "") return false;
  const claimedAt = channel === "whapi" ? guest?.claimed_at_whapi : guest?.claimed_at;
  const idleMinutes = opts?.idleReleaseMinutes ?? DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES;
  const now = opts?.now ?? new Date();
  return !isStaffClaimTimestampExpired(claimedAt, now, idleMinutes);
}

/** Minutes until idle release; null when not claimed or already expired. */
export function minutesUntilStaffClaimRelease(
  claimedAt: unknown,
  now: Date,
  idleMinutes: number,
): number | null {
  if (claimedAt == null || claimedAt === "") return null;
  const ts = new Date(String(claimedAt)).getTime();
  if (!Number.isFinite(ts)) return null;
  const remainingMs = ts + idleMinutes * 60_000 - now.getTime();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / 60_000);
}

/** Cron: clear Meta claims and Whapi channel claims past idle TTL. */
export async function releaseStaleStaffClaims(
  supabaseClient: unknown,
  idleMinutes: number,
  now: Date = new Date(),
): Promise<{ metaReleased: number; whapiReleased: number }> {
  const cutoff = new Date(now.getTime() - idleMinutes * 60_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseClient as any;

  const { data: metaRows, error: metaSelErr } = await supabase
    .from("guests")
    .select("id")
    .not("claimed_by", "is", null)
    .not("claimed_at", "is", null)
    .lt("claimed_at", cutoff);
  if (metaSelErr) {
    console.warn("[guestStaffClaim] meta stale select failed:", metaSelErr.message);
  }

  const metaIds = (metaRows ?? []).map((r: { id: number }) => r.id);
  let metaReleased = 0;
  if (metaIds.length > 0) {
    const { error: metaUpdErr } = await supabase
      .from("guests")
      .update({ claimed_by: null, claimed_at: null })
      .in("id", metaIds);
    if (metaUpdErr) {
      console.warn("[guestStaffClaim] meta stale release failed:", metaUpdErr.message);
    } else {
      metaReleased = metaIds.length;
      console.info(`[guestStaffClaim] released ${metaReleased} stale Meta claim(s)`);
    }
  }

  const { data: whapiRows, error: whapiSelErr } = await supabase
    .from("guest_channel_claims")
    .select("guest_id")
    .not("claimed_by", "is", null)
    .lt("claimed_at", cutoff);
  if (whapiSelErr) {
    console.warn("[guestStaffClaim] whapi stale select failed:", whapiSelErr.message);
  }

  const whapiCount = (whapiRows ?? []).length;
  let whapiReleased = 0;
  if (whapiCount > 0) {
    const { error: whapiDelErr } = await supabase
      .from("guest_channel_claims")
      .delete()
      .not("claimed_by", "is", null)
      .lt("claimed_at", cutoff);
    if (whapiDelErr) {
      console.warn("[guestStaffClaim] whapi stale release failed:", whapiDelErr.message);
    } else {
      whapiReleased = whapiCount;
      console.info(`[guestStaffClaim] released ${whapiReleased} stale Whapi claim(s)`);
    }
  }

  return { metaReleased, whapiReleased };
}

/** Bump claimed_at when thread activity continues under an active claim. */
export async function touchStaffClaimActivity(
  supabaseClient: unknown,
  guestId: number | string | null,
  channel: "meta" | "whapi",
): Promise<void> {
  if (guestId == null || guestId === "") return;
  const id = Number(guestId);
  if (!Number.isFinite(id)) return;
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseClient as any;

  if (channel === "whapi") {
    const { data, error } = await supabase
      .from("guest_channel_claims")
      .select("claimed_by")
      .eq("guest_id", id)
      .eq("inbox_channel", "whapi")
      .maybeSingle();
    if (error || !data?.claimed_by) return;
    const { error: updErr } = await supabase
      .from("guest_channel_claims")
      .update({ claimed_at: now })
      .eq("guest_id", id)
      .eq("inbox_channel", "whapi");
    if (updErr) console.warn("[guestStaffClaim] whapi touch failed:", updErr.message);
    return;
  }

  const { data, error } = await supabase
    .from("guests")
    .select("claimed_by")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.claimed_by) return;
  const { error: updErr } = await supabase
    .from("guests")
    .update({ claimed_at: now })
    .eq("id", id);
  if (updErr) console.warn("[guestStaffClaim] meta touch failed:", updErr.message);
}
