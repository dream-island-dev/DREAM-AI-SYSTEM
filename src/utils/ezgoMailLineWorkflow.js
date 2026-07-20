// Mirror of supabase/functions/_shared/ezgoMailLineWorkflow.ts (frontend).

import { GENERIC_DAY_PASS_ROOM } from "../data/suiteRegistry";
import { buildDoc1EnrichmentPatch } from "./guestImportIntelligence";
import { isCanonicalSuiteRoom, isPremiumDayRoom } from "./pipelineSegment";

export const WORKFLOW_META = {
  suite_spa_sync: { text: "סנכרון ספא סוויטה", color: "#1E40AF", bg: "#DBEAFE" },
  daypass_upsell: { text: "הצעת ספא", color: "#0E7490", bg: "#CFFAFE" },
  daypass_create: { text: "צור בילוי יומי", color: "#92400E", bg: "#FEF3C7" },
  daypass_create_spa: { text: "צור בילוי יומי + ספא", color: "#155E75", bg: "#A5E4EF" },
  enrich: { text: "העשרה", color: "#1E40AF", bg: "#DBEAFE" },
  no_match: { text: "אין פרופיל", color: "#92400E", bg: "#FEF3C7" },
  conflict: { text: "בדוק", color: "#A32D2D", bg: "#FCEBEB" },
  noop: { text: "ללא שינוי", color: "#666", bg: "#eee" },
};

function isEffectiveSuiteGuest(guest) {
  if (!guest) return false;
  if (isPremiumDayRoom(guest.room)) return false;
  return isCanonicalSuiteRoom(guest.room);
}

function isEffectiveDayPassGuest(guest) {
  if (!guest) return false;
  if (isCanonicalSuiteRoom(guest.room)) return false;
  if (isPremiumDayRoom(guest.room)) return true;
  const rt = String(guest.room_type || "");
  if (rt !== "day_guest" && rt !== "premium_day_guest") return false;
  return String(guest.room || "").trim() !== "";
}

function guestHasSpaOnDate(guest, reportDateYmd) {
  if (!guest) return false;
  const day = (reportDateYmd || guest.arrival_date || "").slice(0, 10);
  return !!guest.spa_time || (!!guest.spa_date && guest.spa_date.slice(0, 10) === day);
}

function nameConflict(rec, guest) {
  if (!rec?.guest_name || !guest?.name) return false;
  return rec.guest_name.trim() !== String(guest.name).trim();
}

function patchHasChanges(patch) {
  return Object.keys(patch || {}).filter((k) => !k.startsWith("_")).length > 0;
}

function withWorkflowMeta(patch, workflow) {
  return { ...(patch || {}), _workflow: workflow };
}

export function classifyEzgoMailWorkflow(rec, guest, reportDateYmd) {
  const reportDate = rec?.arrival_date
    ? String(rec.arrival_date).slice(0, 10)
    : (reportDateYmd || "").slice(0, 10) || null;

  if (!guest) {
    if (!rec?.phone) {
      return {
        workflow: "no_match",
        action: "no_match",
        label: "חסר טלפון — לא ניתן ליצור פרופיל",
        patch: withWorkflowMeta({}, "no_match"),
      };
    }
    if (rec.spa_time) {
      return {
        workflow: "daypass_create_spa",
        action: "create",
        label: `צור בילוי יומי + ספא ${rec.spa_time} · מס׳ ${rec.order_number || "—"}`,
        patch: withWorkflowMeta({}, "daypass_create_spa"),
      };
    }
    return {
      workflow: "daypass_create",
      action: "create",
      label: `צור בילוי יומי (ללא ספא) · מס׳ ${rec.order_number || "—"}`,
      patch: withWorkflowMeta({}, "daypass_create"),
    };
  }

  if (nameConflict(rec, guest)) {
    return {
      workflow: "conflict",
      action: "conflict",
      label: `שם לא תואם: דוח «${rec.guest_name}» ≠ פרופיל «${guest.name}»`,
      patch: withWorkflowMeta(buildDoc1EnrichmentPatch(rec, guest), "conflict"),
    };
  }

  if (isEffectiveSuiteGuest(guest)) {
    const patch = buildDoc1EnrichmentPatch(rec, guest);
    if (rec.spa_time) {
      return {
        workflow: "suite_spa_sync",
        action: "enrich",
        label: `סוויטה · מס׳ ${rec.order_number}${guest.name ? ` → ${guest.name}` : ""}${guest.room ? ` · ${guest.room}` : ""}`,
        patch: withWorkflowMeta(patch, "suite_spa_sync"),
      };
    }
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${guest.name || "סוויטה"} · אין שדות חדשים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "enrich",
      action: "enrich",
      label: `סוויטה · מס׳ ${rec.order_number} → ${guest.name}`,
      patch: withWorkflowMeta(patch, "enrich"),
    };
  }

  if (isEffectiveDayPassGuest(guest)) {
    const mergedSpa = rec.spa_time || guest.spa_time;
    const upsellEligible = !mergedSpa
      && !guestHasSpaOnDate({ ...guest, spa_time: mergedSpa }, reportDate)
      && !guest.msg_spa_upsell_sent;

    if (upsellEligible) {
      return {
        workflow: "daypass_upsell",
        action: "enrich",
        label: `הצעת ספא · ${guest.name || rec.guest_name || "בילוי יומי"} · אין טיפול היום`,
        patch: withWorkflowMeta({}, "daypass_upsell"),
      };
    }

    const patch = buildDoc1EnrichmentPatch(rec, guest);
    if (!patchHasChanges(patch)) {
      return {
        workflow: "noop",
        action: "enrich",
        label: `${guest.name || "בילוי יומי"} · אין שדות חדשים`,
        patch: withWorkflowMeta(patch, "noop"),
      };
    }
    return {
      workflow: "enrich",
      action: "enrich",
      label: `בילוי יומי · מס׳ ${rec.order_number} → ${guest.name}`,
      patch: withWorkflowMeta(patch, "enrich"),
    };
  }

  const patch = buildDoc1EnrichmentPatch(rec, guest);
  if (!patchHasChanges(patch)) {
    return {
      workflow: "noop",
      action: "enrich",
      label: `${guest.name || "אורח"} · אין שדות חדשים`,
      patch: withWorkflowMeta(patch, "noop"),
    };
  }
  return {
    workflow: "enrich",
    action: "enrich",
    label: `מס׳ ${rec.order_number} → ${guest.name}`,
    patch: withWorkflowMeta(patch, "enrich"),
  };
}

export function resolveLineWorkflow(line, reportDateYmd) {
  const stored = line?.proposed_patch?._workflow;
  if (stored) return stored;
  const rec = line?.parsed_json || {};
  const guest = line?.guests
    ? {
      ...line.guests,
      room_type: line.guests.room_type,
      spa_date: line.guests.spa_date,
      msg_spa_upsell_sent: line.guests.msg_spa_upsell_sent,
      departure_date: line.guests.departure_date,
    }
    : null;
  return classifyEzgoMailWorkflow(rec, guest, reportDateYmd).workflow;
}

export function stripWorkflowPatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

export async function createDaypassGuestFromRec(supabase, rec, reportDateYmd) {
  const recArrivalDate = rec.arrival_date || reportDateYmd;
  const insert = {
    phone: rec.phone,
    name: rec.guest_name || null,
    arrival_date: recArrivalDate,
    departure_date: recArrivalDate,
    room_type: "day_guest",
    room: GENERIC_DAY_PASS_ROOM,
    status: "pending",
    order_number: rec.order_number || null,
    treatment_count: rec.treatment_count ?? 0,
    meal_time: rec.meal_time || null,
    meal_location: rec.meal_location || null,
  };
  if (rec.spa_time) {
    insert.spa_time = rec.spa_time;
    insert.spa_date = recArrivalDate;
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
      arrival_date: recArrivalDate,
      status: "expected",
      room_count: 1,
    }, { onConflict: "phone,arrival_date" });
  }

  return inserted;
}
