// Guest Club WA invite + suite departure survey fallback — bot_config.guest_club_wa_settings

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const GUEST_CLUB_WA_SETTINGS_KEY = "guest_club_wa_settings";

export type GuestClubWaSettings = {
  wa_invite_enabled: boolean;
  wa_invite_delay_minutes: number;
  portal_offer_enabled: boolean;
  departure_fallback_enabled: boolean;
  departure_fallback_time: string;
};

export const DEFAULT_GUEST_CLUB_WA_SETTINGS: GuestClubWaSettings = {
  wa_invite_enabled: true,
  wa_invite_delay_minutes: 3,
  portal_offer_enabled: false,
  departure_fallback_enabled: true,
  departure_fallback_time: "19:00",
};

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function normalizeGuestClubWaSettings(raw: unknown): GuestClubWaSettings {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_GUEST_CLUB_WA_SETTINGS };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_GUEST_CLUB_WA_SETTINGS };
  }
  const o = parsed as Record<string, unknown>;
  const delayRaw = parseInt(String(o.wa_invite_delay_minutes ?? ""), 10);
  const delay = Number.isFinite(delayRaw) ? Math.min(Math.max(delayRaw, 0), 60) : 3;
  const timeRaw = String(o.departure_fallback_time ?? "19:00").trim();
  const departure_fallback_time = HHMM_RE.test(timeRaw) ? timeRaw : "19:00";
  return {
    wa_invite_enabled: o.wa_invite_enabled !== false,
    wa_invite_delay_minutes: delay,
    portal_offer_enabled: o.portal_offer_enabled === true,
    departure_fallback_enabled: o.departure_fallback_enabled !== false,
    departure_fallback_time,
  };
}

export async function loadGuestClubWaSettings(
  supabase: SupabaseClient,
): Promise<GuestClubWaSettings> {
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", GUEST_CLUB_WA_SETTINGS_KEY)
    .maybeSingle();
  return normalizeGuestClubWaSettings(data?.config_value ?? null);
}

/** True when club offer should appear in portal after positive survey. */
export function shouldOfferClubInPortal(settings: GuestClubWaSettings): boolean {
  return settings.portal_offer_enabled;
}

/** True when club invite should be queued/sent via WA after positive review path. */
export function shouldOfferClubViaWa(settings: GuestClubWaSettings): boolean {
  return settings.wa_invite_enabled;
}

export function parseIsraelLocalHm(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

export function isPastIsraelLocalTime(now: Date, hm: string): boolean {
  const m = hm.match(HHMM_RE);
  if (!m) return false;
  const targetH = parseInt(m[1], 10);
  const targetM = parseInt(m[2], 10);
  const { hour, minute } = parseIsraelLocalHm(now);
  return hour > targetH || (hour === targetH && minute >= targetM);
}
