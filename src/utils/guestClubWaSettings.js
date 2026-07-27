// Guest Club WA invite settings — mirror of supabase/functions/_shared/guestClubWaSettings.ts

export const GUEST_CLUB_WA_SETTINGS_KEY = "guest_club_wa_settings";

export const DEFAULT_GUEST_CLUB_WA_SETTINGS = {
  wa_invite_enabled: true,
  wa_invite_delay_minutes: 3,
  portal_offer_enabled: true,
  departure_fallback_enabled: true,
  departure_fallback_time: "19:00",
};

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function normalizeGuestClubWaSettings(raw) {
  let parsed = raw;
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
  const delayRaw = parseInt(String(parsed.wa_invite_delay_minutes ?? ""), 10);
  const delay = Number.isFinite(delayRaw) ? Math.min(Math.max(delayRaw, 0), 60) : 3;
  const timeRaw = String(parsed.departure_fallback_time ?? "19:00").trim();
  const departure_fallback_time = HHMM_RE.test(timeRaw) ? timeRaw : "19:00";
  return {
    wa_invite_enabled: parsed.wa_invite_enabled !== false,
    wa_invite_delay_minutes: delay,
    portal_offer_enabled: parsed.portal_offer_enabled !== false,
    departure_fallback_enabled: parsed.departure_fallback_enabled !== false,
    departure_fallback_time,
  };
}

export function serializeGuestClubWaSettings(settings) {
  return JSON.stringify(normalizeGuestClubWaSettings(settings));
}
