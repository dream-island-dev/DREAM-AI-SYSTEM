// Mirror of supabase/functions/_shared/ezgoDoc2MailLineWorkflow.ts (frontend).

import { GENERIC_DAY_PASS_ROOM } from "../data/suiteRegistry";
import { isCanonicalSuiteRoom, isPremiumDayRoom } from "./pipelineSegment";
import { createDaypassGuestFromRec, stripWorkflowPatch } from "./ezgoMailLineWorkflow";

export const DOC2_WORKFLOW_META = {
  suite_arrival_create: { text: "צור סוויטה", color: "#1E40AF", bg: "#DBEAFE" },
  suite_arrival_enrich: { text: "השלמת חסר", color: "#0E7490", bg: "#CFFAFE" },
  suite_room_assign: { text: "שיבוץ חדר", color: "#92400E", bg: "#FEF3C7" },
  daypass_create: { text: "צור בילוי יומי", color: "#155E75", bg: "#A5E4EF" },
  conflict: { text: "בדוק", color: "#A32D2D", bg: "#FCEBEB" },
  no_match: { text: "אין פרופיל", color: "#92400E", bg: "#FEF3C7" },
  noop: { text: "ללא שינוי", color: "#666", bg: "#eee" },
};

export const DOC2_WORKFLOW_SECTIONS = [
  { id: "suite_arrival_create", title: "🆕 כניסות חדשות — צור פרופיל סוויטה", hint: "אין פרופיל ב-DB · טלפון + חדר מזוהים" },
  { id: "suite_arrival_enrich", title: "📥 השלמת חסר — אורח קיים", hint: "ממלא רק שדות ריקים (חדר / תאריכים / פנסיון)" },
  { id: "suite_room_assign", title: "🏨 שיבוץ חדר", hint: "פרופיל קיים בלי חדר" },
  { id: "daypass_create", title: "☀️ צור בילוי יומי", hint: "Premium Day / בילוי יומי" },
  { id: "conflict", title: "⚠ בדוק", hint: "התנגשות שם/חדר — אישור ידני בלבד" },
  { id: "other", title: "📋 אחר", hint: "יציאות / ללא שינוי" },
];

function patchHasChanges(patch) {
  return Object.keys(patch || {}).filter((k) => !k.startsWith("_")).length > 0;
}

function pickEnrichValue(importVal, existingVal) {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (existingVal === undefined || existingVal === null || existingVal === "") return importVal;
  return undefined;
}

export function buildDoc2EnrichmentPatch(rec, guest) {
  if (!guest) return {};
  const patch = {};
  if (rec.room) {
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
    const picked = pickEnrichValue(rec.departure_date, guest.departure_date);
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
  return patch;
}

export function classifyDoc2MailWorkflow(rec, guest) {
  if (rec?.section === "departure") {
    return {
      workflow: "noop",
      action: "enrich",
      label: "יציאה — ללא פעולה אוטומטית",
      patch: { _workflow: "noop" },
    };
  }
  if (!rec?.phone) {
    return {
      workflow: "no_match",
      action: "no_match",
      label: "חסר טלפון — לא ניתן ליצור/לעדכן",
      patch: { _workflow: "no_match" },
    };
  }
  if (!rec.room && !rec.is_day_guest) {
    return {
      workflow: "no_match",
      action: "no_match",
      label: `חדר לא מזוהה · ${rec.room_raw || "—"}`,
      patch: { _workflow: "no_match" },
    };
  }
  if (!guest) {
    if (rec.is_day_guest || isPremiumDayRoom(rec.room)) {
      return {
        workflow: "daypass_create",
        action: "create",
        label: `צור בילוי יומי · ${rec.guest_name || rec.phone}`,
        patch: { _workflow: "daypass_create" },
      };
    }
    return {
      workflow: "suite_arrival_create",
      action: "create",
      label: `צור סוויטה · ${rec.guest_name || "—"} · ${rec.room}`,
      patch: { _workflow: "suite_arrival_create" },
    };
  }

  const patch = buildDoc2EnrichmentPatch(rec, guest);
  if (!guest.room && rec.room && isCanonicalSuiteRoom(rec.room)) {
    return {
      workflow: "suite_room_assign",
      action: "enrich",
      label: `שיבוץ חדר · ${guest.name || rec.guest_name} → ${rec.room}`,
      patch: { ...patch, room: rec.room, _workflow: "suite_room_assign" },
    };
  }
  if (!patchHasChanges(patch)) {
    return {
      workflow: "noop",
      action: "enrich",
      label: `${guest.name || "אורח"} · אין שדות חדשים`,
      patch: { _workflow: "noop" },
    };
  }
  return {
    workflow: "suite_arrival_enrich",
    action: "enrich",
    label: `השלמת חסר · ${guest.name || rec.guest_name}`,
    patch: { ...patch, _workflow: "suite_arrival_enrich" },
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
  const arrival = rec.arrival_date || reportDateYmd;
  const insert = {
    phone: rec.phone,
    name: rec.guest_name || null,
    arrival_date: arrival,
    departure_date: rec.departure_date || arrival,
    room: rec.room,
    room_type: rec.is_premium_day ? "premium_day_guest" : (rec.is_day_guest ? "day_guest" : "suite"),
    status: "expected",
    order_number: rec.order_number || null,
    meal_location: rec.meal_location || null,
  };
  if (rec.is_day_guest && !rec.is_premium_day) {
    insert.room = GENERIC_DAY_PASS_ROOM;
  }

  const { data: inserted, error } = await supabase
    .from("guests")
    .insert(insert)
    .select("id, name, phone")
    .maybeSingle();
  if (error) throw error;

  if (inserted?.phone) {
    await supabase.from("bookings").upsert({
      phone: inserted.phone.replace(/^\+/, ""),
      guest_name: rec.guest_name || null,
      arrival_date: arrival,
      status: "expected",
      room_count: 1,
    }, { onConflict: "phone,arrival_date" });
  }

  return inserted;
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
