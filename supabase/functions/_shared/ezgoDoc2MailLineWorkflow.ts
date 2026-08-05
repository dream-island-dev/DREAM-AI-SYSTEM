// Doc2 mail line workflow — suite arrivals create / enrich / room assign.

import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import { israelYmd } from "./automationSchedule.ts";
import { shouldTreatAsReturningGuestCreate } from "./guestProfilePick.ts";
import {
  guestRoomLabelsInclude,
  isSameDoc2Booking,
} from "./ezgoDoc2SuiteRoomSync.ts";
import {
  isCanonicalSuiteRoom,
  isPremiumDayRoom,
  roomsCanonicallyMatch,
} from "./suiteNames.ts";
import { mergeAutomationScope } from "./importAutomationScope.ts";
import { isSuiteStayGuest } from "./guestDepartureGuard.ts";

export type Doc2MailWorkflow =
  | "suite_arrival_create"
  | "suite_arrival_enrich"
  | "suite_room_assign"
  | "suite_room_add"
  | "daypass_create"
  | "conflict"
  | "no_match"
  | "noop";

export type Doc2GuestRow = {
  id: number;
  name: string | null;
  phone: string | null;
  order_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  room: string | null;
  room_type?: string | null;
  meal_location: string | null;
  meal_time?: string | null;
  automation_scope?: string | null;
};

function patchHasChanges(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).filter((k) => !k.startsWith("_")).length > 0;
}

function withWorkflowMeta(
  patch: Record<string, unknown>,
  workflow: Doc2MailWorkflow,
): Record<string, unknown> {
  return { ...patch, _workflow: workflow };
}

function pickEnrichValue(importVal: unknown, existingVal: unknown): unknown {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (existingVal === undefined || existingVal === null || existingVal === "") return importVal;
  return undefined;
}

/**
 * True when a suite-stay guest's dates carry the 0-night bug signature (P0
 * 2026-08-05: arrival===departure, or departure missing entirely) — the only
 * case where a Doc2 re-import is allowed to correct an already-populated
 * departure_date instead of leaving it alone (fill-empty-only everywhere else).
 */
function isSuspectSuiteStayDates(guest: Doc2GuestRow): boolean {
  if (!isSuiteStayGuest({ room_type: guest.room_type, room: guest.room })) return false;
  if (!guest.departure_date) return true;
  return !!guest.arrival_date && guest.arrival_date === guest.departure_date;
}

function pickDoc2SnapshotValue(
  importVal: unknown,
  existingVal: unknown,
  { allowOverwrite }: { allowOverwrite: boolean },
): unknown {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (allowOverwrite) return importVal;
  return pickEnrichValue(importVal, existingVal);
}

export function buildDoc2EnrichmentPatch(
  rec: Doc2Record,
  guest: Doc2GuestRow | null,
): Record<string, unknown> {
  if (!guest) return {};
  const patch: Record<string, unknown> = {};

  const room = rec.room || null;
  if (room && !guest.room) {
    const picked = pickEnrichValue(room, guest.room);
    if (picked !== undefined) patch.room = picked;
  }
  if (rec.order_number) {
    const picked = pickEnrichValue(rec.order_number, guest.order_number);
    if (picked !== undefined) patch.order_number = picked;
  }
  if (rec.arrival_date) {
    const picked = pickEnrichValue(rec.arrival_date, guest.arrival_date);
    if (picked !== undefined) patch.arrival_date = picked;
  }
  if (rec.departure_date) {
    const allowOverwrite = isSuspectSuiteStayDates(guest)
      && (!guest.arrival_date || rec.departure_date > guest.arrival_date);
    const picked = pickDoc2SnapshotValue(rec.departure_date, guest.departure_date, { allowOverwrite });
    if (picked !== undefined) patch.departure_date = picked;
  }
  if (rec.meal_location) {
    const picked = pickEnrichValue(rec.meal_location, guest.meal_location);
    if (picked !== undefined) patch.meal_location = picked;
  }
  if (rec.guest_name) {
    const picked = pickEnrichValue(rec.guest_name, guest.name);
    if (picked !== undefined) patch.name = picked;
  }
  if (rec.meal_time) {
    const picked = pickEnrichValue(rec.meal_time, guest.meal_time);
    if (picked !== undefined) patch.meal_time = picked;
  }
  if (rec.automation_scope) {
    const merged = mergeAutomationScope(guest.automation_scope, rec.automation_scope);
    if (merged !== (guest.automation_scope ?? "full")) {
      patch.automation_scope = merged;
      patch.automation_muted = merged === "muted";
    }
  }
  return patch;
}

function nameConflict(rec: Doc2Record, guest: Doc2GuestRow): boolean {
  if (!rec.guest_name || !guest.name) return false;
  return rec.guest_name.trim() !== String(guest.name).trim();
}

function roomConflict(rec: Doc2Record, guest: Doc2GuestRow): boolean {
  if (!rec.room || !guest.room) return false;
  return !roomsCanonicallyMatch(rec.room, guest.room);
}

export function classifyDoc2MailWorkflow(
  rec: Doc2Record,
  guest: Doc2GuestRow | null,
): {
  workflow: Doc2MailWorkflow;
  action: "enrich" | "create" | "no_match" | "conflict";
  label: string;
  patch: Record<string, unknown>;
} {
  const today = israelYmd();
  const reportDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  let matchedGuest = guest;
  if (matchedGuest && shouldTreatAsReturningGuestCreate(matchedGuest, rec, reportDate, today)) {
    matchedGuest = null;
  }

  if (rec.section === "departure") {
    return {
      workflow: "noop",
      action: "enrich",
      label: "יציאה — ללא פעולה אוטומטית (בדיקה ידנית)",
      patch: withWorkflowMeta({}, "noop"),
    };
  }

  if (!rec.phone) {
    return {
      workflow: "no_match",
      action: "no_match",
      label: "חסר טלפון — לא ניתן ליצור/לעדכן",
      patch: withWorkflowMeta({}, "no_match"),
    };
  }

  if (!matchedGuest) {
    // SUITE-FIRST (Mike, P0 2026-08-05): rec.room already wins over a day-pass
    // label at parse time (resolveSuiteRoomFromEzgoLabel), but this guard stays
    // as defense-in-depth against a stale is_day_guest on an older parsed_json
    // row — never route to daypass_create when the room resolved to a canonical
    // suite.
    if ((rec.is_day_guest || isPremiumDayRoom(rec.room)) && !isCanonicalSuiteRoom(rec.room)) {
      return {
        workflow: "daypass_create",
        action: "create",
        label: `צור בילוי יומי · ${rec.guest_name || rec.phone} · ${rec.room || rec.room_raw}`,
        patch: withWorkflowMeta({}, "daypass_create"),
      };
    }
    if (rec.room) {
      return {
        workflow: "suite_arrival_create",
        action: "create",
        label: `צור סוויטה · ${rec.guest_name || "—"} · ${rec.room} · מס׳ ${rec.order_number || "—"}`,
        patch: withWorkflowMeta({}, "suite_arrival_create"),
      };
    }
    if (rec.phone && (rec.guest_name || rec.order_number)) {
      return {
        workflow: "suite_arrival_create",
        action: "create",
        label: `צור סוויטה · ${rec.guest_name || "—"} · חדר יישוב מאוחר · מס׳ ${rec.order_number || "—"}`,
        patch: withWorkflowMeta({}, "suite_arrival_create"),
      };
    }
    return {
      workflow: "no_match",
      action: "no_match",
      label: `חסר פרטים ליצירה · ${rec.room_raw || "—"}`,
      patch: withWorkflowMeta({}, "no_match"),
    };
  }

  if (!rec.room) {
    const patch = buildDoc2EnrichmentPatch(rec, matchedGuest);
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${matchedGuest.name || "אורח"} · אין שדות חדשים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "suite_arrival_enrich",
      action: "enrich",
      label: `השלמת חסר · ${matchedGuest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
      patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
    };
  }

  if (nameConflict(rec, matchedGuest) && roomConflict(rec, matchedGuest)) {
    return {
      workflow: "conflict",
      action: "conflict",
      label: `⚠ בדוק שם+חדר · DB: ${matchedGuest.name} / ${matchedGuest.room || "—"}`,
      patch: withWorkflowMeta({}, "conflict"),
    };
  }

  if (rec.room && guestRoomLabelsInclude(matchedGuest.room, rec.room)) {
    const patch = buildDoc2EnrichmentPatch(rec, matchedGuest);
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${matchedGuest.name || "אורח"} · חדר ${rec.room} כבר קיים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "suite_arrival_enrich",
      action: "enrich",
      label: `השלמת חסר · ${matchedGuest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
      patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
    };
  }

  if (roomConflict(rec, matchedGuest) && isSameDoc2Booking(rec, matchedGuest) && rec.room) {
    return {
      workflow: "suite_room_add",
      action: "enrich",
      label: `➕ חדר נוסף · ${matchedGuest.name || rec.guest_name} → ${rec.room}`,
      patch: withWorkflowMeta({ _add_room: rec.room }, "suite_room_add"),
    };
  }

  if (!matchedGuest.room && rec.room && isCanonicalSuiteRoom(rec.room)) {
    return {
      workflow: "suite_room_assign",
      action: "enrich",
      label: `שיבוץ חדר · ${matchedGuest.name || rec.guest_name} → ${rec.room}`,
      patch: withWorkflowMeta({ room: rec.room }, "suite_room_assign"),
    };
  }

  if (roomConflict(rec, matchedGuest)) {
    return {
      workflow: "conflict",
      action: "conflict",
      label: `⚠ חדר שונה · DB: ${matchedGuest.room} · דוח: ${rec.room}`,
      patch: withWorkflowMeta({}, "conflict"),
    };
  }

  const patch = buildDoc2EnrichmentPatch(rec, matchedGuest);
  if (!patchHasChanges(patch)) {
    return {
      workflow: "noop",
      action: "enrich",
      label: `${matchedGuest.name || "אורח"} · אין שדות חדשים`,
      patch: withWorkflowMeta(patch, "noop"),
    };
  }

  return {
    workflow: "suite_arrival_enrich",
    action: "enrich",
    label: `השלמת חסר · ${matchedGuest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
    patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
  };
}
