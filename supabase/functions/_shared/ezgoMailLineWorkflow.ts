// Classify Doc1 mail lines into suite spa sync / daypass upsell / daypass create.

import {
  buildDoc1EnrichmentPatch,
  type Doc1Record,
} from "./ezgoDoc1Parser.ts";
import {
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
} from "./suiteNames.ts";

export type EzgoMailWorkflow =
  | "suite_spa_sync"
  | "daypass_upsell"
  | "daypass_create"
  | "daypass_create_spa"
  | "enrich"
  | "no_match"
  | "conflict"
  | "noop";

export type GuestWorkflowRow = {
  id: number;
  name: string | null;
  phone: string | null;
  order_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  room: string | null;
  room_type?: string | null;
  spa_time: string | null;
  spa_date?: string | null;
  meal_location: string | null;
  meal_time: string | null;
  treatment_count: number | null;
  msg_spa_upsell_sent?: boolean | null;
};

export type WorkflowClassification = {
  workflow: EzgoMailWorkflow;
  action: "enrich" | "create" | "no_match" | "conflict";
  label: string;
  patch: Record<string, unknown>;
};

export function guestHasSpaOnDate(
  guest: GuestWorkflowRow | null,
  reportDateYmd: string | null,
): boolean {
  if (!guest) return false;
  const day = reportDateYmd?.slice(0, 10) || guest.arrival_date?.slice(0, 10) || null;
  return !!guest.spa_time || (!!guest.spa_date && !!day && guest.spa_date.slice(0, 10) === day);
}

function nameConflict(rec: Doc1Record, guest: GuestWorkflowRow): boolean {
  if (!rec.guest_name || !guest.name) return false;
  return rec.guest_name.trim() !== String(guest.name).trim();
}

function patchHasChanges(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).filter((k) => !k.startsWith("_")).length > 0;
}

function withWorkflowMeta(
  patch: Record<string, unknown>,
  workflow: EzgoMailWorkflow,
): Record<string, unknown> {
  return { ...patch, _workflow: workflow };
}

export function classifyEzgoMailWorkflow(
  rec: Doc1Record,
  guest: GuestWorkflowRow | null,
  reportDateYmd: string | null,
): WorkflowClassification {
  const reportDate = rec.arrival_date
    ? String(rec.arrival_date).slice(0, 10)
    : reportDateYmd?.slice(0, 10) ?? null;

  if (!guest) {
    if (!rec.phone) {
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
    const mergedSpaDate = rec.spa_time ? (reportDate || guest.spa_date) : guest.spa_date;
    const upsellEligible = !mergedSpa
      && !guestHasSpaOnDate({ ...guest, spa_time: mergedSpa, spa_date: mergedSpaDate ?? null }, reportDate)
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

/** Strip internal keys before writing to guests. */
export function stripWorkflowPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

export function resolveLineWorkflow(
  line: { proposed_patch?: Record<string, unknown> | null },
): EzgoMailWorkflow {
  const w = line.proposed_patch?._workflow;
  return (typeof w === "string" ? w : "enrich") as EzgoMailWorkflow;
}
