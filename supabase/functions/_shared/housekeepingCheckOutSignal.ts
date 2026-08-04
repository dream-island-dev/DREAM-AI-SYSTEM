// Housekeeping group "Co N" / "N co" → guests.checked_out + room_status.לניקיון.
// Turnover step 1 of 4 — next: N✅ (ממתין לאישור) → manager approve → צק אין.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import {
  findActiveGuestForSuite,
  findDepartingGuestForSuite,
  findIncomingGuestForSuiteCheckIn,
  formatAmbiguousGuestHint,
} from "./housekeepingGuestLookup.ts";
import { enqueueSuitePostCheckoutSurvey } from "./postCheckoutSurvey.ts";
import { performSuiteCheckOut, syncRoomToCleaning } from "./suiteCheckinSync.ts";

export type HousekeepingCheckOutAction =
  | "updated"
  | "already_checked_out"
  | "dedup"
  | "skipped_no_suite"
  | "no_guest"
  | "ambiguous_guest"
  | "error";

export interface HousekeepingCheckOutResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  guestId: number | null;
  guestName: string | null;
  incomingGuestName?: string | null;
  action: HousekeepingCheckOutAction;
  noGuestHint?: string;
  surveyQueued?: boolean;
  error?: string;
}

function formatTurnoverIncomingHint(incomingGuestName?: string | null): string {
  const name = incomingGuestName?.trim();
  return name ? ` · מגיע היום: ${name}` : "";
}

async function loadIncomingTurnoverName(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  excludeGuestId?: number | null,
): Promise<string | null> {
  const incomingPick = await findIncomingGuestForSuiteCheckIn(supabase, roomId);
  if (incomingPick.ambiguous.length) return null;
  const incoming = incomingPick.guest;
  if (!incoming) return null;
  if (excludeGuestId && Number(incoming.id) === Number(excludeGuestId)) return null;
  return incoming.name?.trim() || null;
}

/** Actions where staff need to see the outcome no matter what — genuine
 * failures/uncertainty, never gated behind HOUSEKEEPING_WA_GROUP_REPLY
 * (Zero Data Loss / Fail Visible, CLAUDE.md §0). Success/no-op confirmations
 * ("updated", "already_checked_out", "dedup") stay opt-in — see whapi-webhook. */
export const HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS: ReadonlySet<HousekeepingCheckOutAction> = new Set([
  "skipped_no_suite",
  "no_guest",
  "ambiguous_guest",
  "error",
]);

export function buildHousekeepingCheckOutAckLine(result: HousekeepingCheckOutResult): string | null {
  const { roomNumber, roomId, guestName, action, noGuestHint, incomingGuestName } = result;
  if (action === "skipped_no_suite") {
    return `⚠️ מספר חדר #${roomNumber} לא מוכר במערכת — צ'ק-אאוט לא נקלט, בדקו את המספר`;
  }
  if (!roomId) return null;
  const incomingHint = formatTurnoverIncomingHint(incomingGuestName);
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אאוט נקלט${guestName ? ` (${guestName})` : ""} · חדר לניקיון${incomingHint}`;
    case "already_checked_out":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אאוט · חדר לניקיון${incomingHint}`;
    case "no_guest":
      return noGuestHint
        ? `⚠️ חדר ${roomId} — לא נמצא אורח שעוזב היום. ${noGuestHint}`
        : `⚠️ חדר ${roomId} — צ'ק-אאוט: לא נמצא אורח שעוזב היום בחדר`;
    case "ambiguous_guest":
      return `⚠️ חדר ${roomId} — כמה אורחים עם עזיבה היום. בדקו ב-XOS.${guestName ? ` (${guestName})` : ""}`;
    case "error":
      return `🚨 חדר ${roomId} — שגיאת מערכת בקליטת צ'ק-אאוט. בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.`;
    case "dedup":
      // Duplicate WhatsApp delivery of an already-processed message — the first
      // attempt already handled it, not a drop. Intentionally silent.
      return null;
    default:
      return null;
  }
}

export async function applyHousekeepingCheckOutSignal(
  supabase: ReturnType<typeof createClient>,
  opts: {
    roomNumber: number;
    waMessageId: string;
    sourceLine?: string;
    fromPhone?: string | null;
    fromName?: string | null;
    profileId?: string | null;
  },
): Promise<HousekeepingCheckOutResult> {
  const { roomNumber, waMessageId, sourceLine } = opts;
  const roomId = resolveSuiteFromEzgoFields(String(roomNumber), "", false);

  if (!roomId) {
    return { ok: false, roomNumber, roomId: null, guestId: null, guestName: null, action: "skipped_no_suite" };
  }

  const { error: dedupErr } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: waMessageId,
    room_number: roomNumber,
    room_id: roomId,
    event_type: "check_out",
    source_line: sourceLine?.slice(0, 500) ?? null,
    from_phone: opts.fromPhone ?? null,
    from_name: opts.fromName ?? null,
    profile_id: opts.profileId ?? null,
  });

  if (dedupErr) {
    if (dedupErr.code === "23505") {
      return { ok: true, roomNumber, roomId, guestId: null, guestName: null, action: "dedup" };
    }
    return {
      ok: false, roomNumber, roomId, guestId: null, guestName: null,
      action: "error", error: dedupErr.message,
    };
  }

  const departingPick = await findDepartingGuestForSuite(supabase, roomId);
  if (departingPick.ambiguous.length) {
    const roomSync = await syncRoomToCleaning(supabase, roomId);
    if (!roomSync.ok) {
      console.warn(`[housekeepingCheckOut] room_status sync failed for ${roomId}:`, roomSync.error);
    }
    return {
      ok: false,
      roomNumber,
      roomId,
      guestId: null,
      guestName: formatAmbiguousGuestHint(departingPick.ambiguous),
      action: "ambiguous_guest",
    };
  }

  const guest = departingPick.guest;
  if (!guest) {
    const [activePick, incomingName] = await Promise.all([
      findActiveGuestForSuite(supabase, roomId),
      loadIncomingTurnoverName(supabase, roomId),
    ]);
    const active = activePick.guest;
    let noGuestHint: string | undefined;
    if (active) {
      const dep = active.departure_date ?? "לא מוגדרת";
      if (active.departure_date && active.departure_date > israelYmd(new Date())) {
        noGuestHint = `בחדר: ${active.name ?? "—"} (עזיבה ${dep} — לא היום)`;
      } else {
        noGuestHint = `בחדר: ${active.name ?? "—"} (סטטוס ${active.status}, עזיבה ${dep})`;
      }
    } else if (incomingName) {
      noGuestHint = `אין אורח יוצא פעיל — מגיע היום: ${incomingName}`;
    }
    const roomSync = await syncRoomToCleaning(supabase, roomId);
    if (!roomSync.ok) {
      console.warn(`[housekeepingCheckOut] room_status sync failed for ${roomId}:`, roomSync.error);
    }
    return {
      ok: roomSync.ok,
      roomNumber,
      roomId,
      guestId: null,
      guestName: null,
      incomingGuestName: incomingName,
      action: "no_guest",
      noGuestHint,
    };
  }

  if (guest.status === "checked_out") {
    const roomSync = await syncRoomToCleaning(supabase, roomId);
    if (!roomSync.ok) {
      console.warn(`[housekeepingCheckOut] room_status sync failed for ${roomId}:`, roomSync.error);
    }
    const survey = await enqueueSuitePostCheckoutSurvey(supabase, {
      guestId: guest.id,
      roomId,
      source: "housekeeping_wa",
    });
    const incomingGuestName = await loadIncomingTurnoverName(supabase, roomId, guest.id);
    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: guest.id,
      guestName: guest.name,
      incomingGuestName,
      action: "already_checked_out",
      surveyQueued: survey.queued,
    };
  }

  const sync = await performSuiteCheckOut(supabase, guest, {
    roomId,
    auditSource: "צ'ק-אאוט מקבוצת ניקיון (WhatsApp)",
  });

  if (!sync.ok) {
    return {
      ok: false, roomNumber, roomId, guestId: guest.id, guestName: guest.name,
      action: "error", error: sync.error,
    };
  }

  const survey = await enqueueSuitePostCheckoutSurvey(supabase, {
    guestId: guest.id,
    roomId,
    source: "housekeeping_wa",
  });

  console.log(
    `[housekeepingCheckOut] ${roomId} (#${roomNumber}) guest=${guest.id} → checked_out + לניקיון survey=${survey.queued}`,
  );

  const incomingGuestName = await loadIncomingTurnoverName(supabase, roomId, guest.id);

  return {
    ok: true,
    roomNumber,
    roomId,
    guestId: guest.id,
    guestName: guest.name,
    incomingGuestName,
    action: "updated",
    surveyQueued: survey.queued,
  };
}
