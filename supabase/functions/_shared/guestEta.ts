// supabase/functions/_shared/guestEta.ts
// Guest ETA (arrival_time) extraction + safe DB persist — Record-Only path (no alerts/tasks).

import { israelYmd } from "./automationSchedule.ts";

export function padHhMm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Strict HH:MM validator — server is source of truth after extraction. */
export function isValidHhMm(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/**
 * Extract HH:MM from guest text (Hebrew + English, 24h + AM/PM).
 * Returns null when no confident time found.
 */
export function extractArrivalTimeFromText(text: string): string | null {
  const t = text.trim();

  const ampm = t.match(
    /(?:^|[^\d])(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
  );
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPm = /^p/i.test(ampm[3]);
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return padHhMm(h, min);
  }

  const colon = t.match(/(?:^|[^\d])(\d{1,2})\s*[:.׳·]\s*(\d{2})(?:\s|$|[^\d])/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return padHhMm(h, m);
  }

  const hourWord = t.match(/(?:בשעה|ב[-–]?\s*|שעה\s+|at\s+|around\s+|approximately\s+)(\d{1,2})(?:\s|$|[^\d:])/i);
  if (hourWord) {
    const h = parseInt(hourWord[1], 10);
    if (h >= 0 && h <= 23) return padHhMm(h, 0);
  }

  const bare = t.match(/^(\d{1,2})\s*[:.׳·]\s*(\d{2})$/);
  if (bare) {
    const h = parseInt(bare[1], 10);
    const m = parseInt(bare[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return padHhMm(h, m);
  }

  return null;
}

/** Upcoming or today arrival — not cancelled, not a past stay row. */
export function isGuestEligibleForEtaUpdate(
  guest: { arrival_date?: string | null; status?: string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!guest?.arrival_date) return false;
  if (guest.status === "cancelled") return false;
  return String(guest.arrival_date) >= israelYmd(now);
}

type GuestEtaRow = {
  guest_notes?: string | null;
  arrival_date?: string | null;
  status?: string | null;
};

type SupabaseLike = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: number) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/** Record-Only ETA — updates arrival_time + audit line; never throws. */
export async function persistGuestEta(
  supabase: SupabaseLike,
  opts: {
    guestId: number;
    guest: GuestEtaRow;
    timeHhMm: string;
    source?: string;
  },
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!isValidHhMm(opts.timeHhMm)) {
    console.warn("[guestEta] persist skipped — invalid HH:MM:", opts.timeHhMm);
    return { ok: false, skipped: "invalid_time" };
  }
  if (!isGuestEligibleForEtaUpdate(opts.guest)) {
    console.info("[guestEta] persist skipped — ineligible guest row");
    return { ok: false, skipped: "ineligible_guest" };
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const src = opts.source ?? "wa";
  const noteLine = `[${stamp}] שעת הגעה: ${opts.timeHhMm} (${src})`;
  const newNotes = opts.guest?.guest_notes
    ? `${opts.guest.guest_notes}\n${noteLine}`
    : noteLine;

  const { error } = await supabase.from("guests").update({
    arrival_time: opts.timeHhMm,
    guest_notes: newNotes,
  }).eq("id", opts.guestId);

  if (error) {
    console.error("[guestEta] persist FAILED:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
