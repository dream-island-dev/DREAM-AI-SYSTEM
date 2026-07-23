// Doc2 mail line workflow — suite arrivals create / enrich / room assign.

import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import {
  guestRoomLabelsInclude,
  isSameDoc2Booking,
} from "./ezgoDoc2SuiteRoomSync.ts";
import {
  isCanonicalSuiteRoom,
  isPremiumDayRoom,
  roomsCanonicallyMatch,
} from "./suiteNames.ts";

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

  if (!guest) {
    if (rec.is_day_guest || isPremiumDayRoom(rec.room)) {
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
    const patch = buildDoc2EnrichmentPatch(rec, guest);
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${guest.name || "אורח"} · אין שדות חדשים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "suite_arrival_enrich",
      action: "enrich",
      label: `השלמת חסר · ${guest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
      patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
    };
  }

  if (nameConflict(rec, guest) && roomConflict(rec, guest)) {
    return {
      workflow: "conflict",
      action: "conflict",
      label: `⚠ בדוק שם+חדר · DB: ${guest.name} / ${guest.room || "—"}`,
      patch: withWorkflowMeta({}, "conflict"),
    };
  }

  if (rec.room && guestRoomLabelsInclude(guest.room, rec.room)) {
    const patch = buildDoc2EnrichmentPatch(rec, guest);
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${guest.name || "אורח"} · חדר ${rec.room} כבר קיים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "suite_arrival_enrich",
      action: "enrich",
      label: `השלמת חסר · ${guest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
      patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
    };
  }

  if (roomConflict(rec, guest) && isSameDoc2Booking(rec, guest) && rec.room) {
    return {
      workflow: "suite_room_add",
      action: "enrich",
      label: `➕ חדר נוסף · ${guest.name || rec.guest_name} → ${rec.room}`,
      patch: withWorkflowMeta({ _add_room: rec.room }, "suite_room_add"),
    };
  }

  if (!guest.room && rec.room && isCanonicalSuiteRoom(rec.room)) {
    return {
      workflow: "suite_room_assign",
      action: "enrich",
      label: `שיבוץ חדר · ${guest.name || rec.guest_name} → ${rec.room}`,
      patch: withWorkflowMeta({ room: rec.room }, "suite_room_assign"),
    };
  }

  if (roomConflict(rec, guest)) {
    return {
      workflow: "conflict",
      action: "conflict",
      label: `⚠ חדר שונה · DB: ${guest.room} · דוח: ${rec.room}`,
      patch: withWorkflowMeta({}, "conflict"),
    };
  }

  const patch = buildDoc2EnrichmentPatch(rec, guest);
  if (!patchHasChanges(patch)) {
    return {
      workflow: "noop",
      action: "enrich",
      label: `${guest.name || "אורח"} · אין שדות חדשים`,
      patch: withWorkflowMeta(patch, "noop"),
    };
  }

  return {
    workflow: "suite_arrival_enrich",
    action: "enrich",
    label: `השלמת חסר · ${guest.name || rec.guest_name} · מס׳ ${rec.order_number || "—"}`,
    patch: withWorkflowMeta(patch, "suite_arrival_enrich"),
  };
}
