// Mirror of supabase/functions/_shared/ezgoDoc2MailLineWorkflow.ts (frontend).

import { GENERIC_DAY_PASS_ROOM, roomsCanonicallyMatch } from "../data/suiteRegistry";
import { isCanonicalSuiteRoom, isPremiumDayRoom } from "./pipelineSegment";
import { israelTodayStr } from "./guestTiming";
import { shouldTreatAsReturningGuestCreate } from "./guestProfilePick";
import { createDaypassGuestFromRec, stripWorkflowPatch } from "./ezgoMailLineWorkflow";
import { isSuiteStayGuest } from "./departureDateGuard";
import {
  createDoc2SuiteArrival,
  guestRoomLabelsInclude,
  isSameDoc2Booking,
} from "./ezgoDoc2SuiteRoomSync";

export const DOC2_WORKFLOW_META = {
  suite_arrival_create: { text: "צור סוויטה", color: "#1E40AF", bg: "#DBEAFE" },
  suite_arrival_enrich: { text: "השלמת חסר", color: "#0E7490", bg: "#CFFAFE" },
  suite_room_assign: { text: "שיבוץ חדר", color: "#92400E", bg: "#FEF3C7" },
  suite_room_add: { text: "חדר נוסף", color: "#166534", bg: "#DCFCE7" },
  daypass_create: { text: "צור בילוי יומי", color: "#155E75", bg: "#A5E4EF" },
  conflict: { text: "בדוק", color: "#A32D2D", bg: "#FCEBEB" },
  no_match: { text: "אין פרופיל", color: "#92400E", bg: "#FEF3C7" },
  noop: { text: "ללא שינוי", color: "#666", bg: "#eee" },
};

export const DOC2_WORKFLOW_SECTIONS = [
  { id: "suite_arrival_create", title: "🆕 כניסות חדשות — צור פרופיל סוויטה", hint: "טלפון חובה · חדר אופציונלי (יישוב מאוחר)" },
  { id: "suite_room_add", title: "➕ חדר נוסף — אותה הזמנה", hint: "מוסיף suite_rooms + מעדכן תווית משולבת ב-guests.room" },
  { id: "suite_arrival_enrich", title: "📥 השלמת חסר — אורח קיים", hint: "ממלא רק שדות ריקים (תאריכים / פנסיון)" },
  { id: "suite_room_assign", title: "🏨 שיבוץ חדר", hint: "פרופיל קיים בלי חדר" },
  { id: "daypass_create", title: "☀️ צור בילוי יומי", hint: "Premium Day / בילוי יומי" },
  { id: "conflict", title: "⚠ בדוק", hint: "התנגשות שם/חדר — אישור ידני בלבד" },
  { id: "other", title: "📋 אחר", hint: "יציאות / ללא שינוי" },
];

function patchHasChanges(patch) {
  return Object.keys(patch || {}).filter((k) => !k.startsWith("_")).length > 0;
}

function withWorkflowMeta(patch, workflow) {
  return { ...patch, _workflow: workflow };
}

function pickEnrichValue(importVal, existingVal) {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (existingVal === undefined || existingVal === null || existingVal === "") return importVal;
  return undefined;
}

// Mirrors _shared/ezgoDoc2MailLineWorkflow.ts's isSuspectSuiteStayDates — the
// only case a Doc2 re-import may correct an already-populated departure_date
// (0-night bug signature: arrival===departure or departure missing) instead
// of leaving it fill-empty-only like every other enrichment field.
function isSuspectSuiteStayDates(guest) {
  if (!isSuiteStayGuest({ room_type: guest.room_type, room: guest.room })) return false;
  if (!guest.departure_date) return true;
  return !!guest.arrival_date && guest.arrival_date === guest.departure_date;
}

function pickDoc2SnapshotValue(importVal, existingVal, { allowOverwrite }) {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (allowOverwrite) return importVal;
  return pickEnrichValue(importVal, existingVal);
}

// Mirrors _shared/importAutomationScope.ts's mergeAutomationScope — never lets
// an enrichment write loosen an already-muted guest back toward full.
function mergeAutomationScope(existing, incoming) {
  const rank = (s) => (s === "muted" ? 2 : s === "courtesy_only" ? 1 : 0);
  const r = Math.max(rank(existing), rank(incoming));
  return r === 2 ? "muted" : r === 1 ? "courtesy_only" : "full";
}

export function buildDoc2EnrichmentPatch(rec, guest) {
  if (!guest) return {};
  const patch = {};
  if (rec.room && !guest.room) {
    const picked = pickEnrichValue(rec.room, guest.room);
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
    if (merged !== (guest.automation_scope || "full")) {
      patch.automation_scope = merged;
      patch.automation_muted = merged === "muted";
    }
  }
  return patch;
}

function nameConflict(rec, guest) {
  if (!rec.guest_name || !guest.name) return false;
  return rec.guest_name.trim() !== String(guest.name).trim();
}

function roomConflict(rec, guest) {
  if (!rec.room || !guest.room) return false;
  return !roomsCanonicallyMatch(rec.room, guest.room);
}

export function classifyDoc2MailWorkflow(rec, guest) {
  const today = israelTodayStr();
  const reportDate = rec?.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  let matchedGuest = guest;
  if (matchedGuest && shouldTreatAsReturningGuestCreate(matchedGuest, rec, reportDate, today)) {
    matchedGuest = null;
  }
  if (matchedGuest && rec.is_remark_group_occupant && !isSameDoc2Booking(rec, matchedGuest)) {
    matchedGuest = null;
  }

  if (rec?.section === "departure") {
    return {
      workflow: "noop",
      action: "enrich",
      label: "יציאה — ללא פעולה אוטומטית",
      patch: withWorkflowMeta({}, "noop"),
    };
  }
  if (!rec?.phone) {
    return {
      workflow: "no_match",
      action: "no_match",
      label: "חסר טלפון — לא ניתן ליצור/לעדכן",
      patch: withWorkflowMeta({}, "no_match"),
    };
  }
  if (!matchedGuest) {
    // SUITE-FIRST (Mike, P0 2026-08-05): rec.room already wins over a day-pass
    // label at parse time server-side; this guard is defense-in-depth against a
    // stale is_day_guest on an older parsed_json row — never route to
    // daypass_create when the room resolved to a canonical suite.
    if ((rec.is_day_guest || isPremiumDayRoom(rec.room)) && !isCanonicalSuiteRoom(rec.room)) {
      return {
        workflow: "daypass_create",
        action: "create",
        label: `צור בילוי יומי · ${rec.guest_name || rec.phone}`,
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

  if (
    roomConflict(rec, matchedGuest)
    && isSameDoc2Booking(rec, matchedGuest)
    && rec.room
    && !rec.is_remark_group_occupant
  ) {
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

  if (roomConflict(rec, matchedGuest) && rec.room && rec.is_remark_group_occupant) {
    if (!guestRoomLabelsInclude(matchedGuest.room, rec.room)) {
      return {
        workflow: "suite_arrival_create",
        action: "create",
        label: `צור סוויטה · ${rec.guest_name || "—"} · ${rec.room} · קבוצה`,
        patch: withWorkflowMeta({}, "suite_arrival_create"),
      };
    }
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

export function resolveDoc2LineWorkflow(line, reportDateYmd) {
  const stored = line?.proposed_patch?._workflow;
  if (stored) return stored;
  const rec = line?.parsed_json || {};
  const guest = line?.guests
    ? {
      ...line.guests,
      meal_location: line.guests.meal_location,
      departure_date: line.guests.departure_date,
    }
    : null;
  return classifyDoc2MailWorkflow(rec, guest).workflow;
}

export async function createSuiteArrivalFromRec(supabase, rec, reportDateYmd) {
  return createDoc2SuiteArrival(supabase, rec, reportDateYmd);
}

export async function createDoc2LineFromRec(supabase, rec, reportDateYmd) {
  if (rec.is_day_guest || isPremiumDayRoom(rec.room)) {
    const dayRec = {
      ...rec,
      guest_name: rec.guest_name,
      phone: rec.phone,
      order_number: rec.order_number,
      arrival_date: rec.arrival_date || reportDateYmd,
      meal_location: rec.meal_location,
      room: rec.is_premium_day ? rec.room : GENERIC_DAY_PASS_ROOM,
    };
    return createDaypassGuestFromRec(supabase, dayRec, reportDateYmd);
  }
  return createSuiteArrivalFromRec(supabase, rec, reportDateYmd);
}

export { stripWorkflowPatch };
