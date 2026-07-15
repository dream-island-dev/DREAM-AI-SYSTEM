// supabase/functions/_shared/adirNotifyMessages.ts
// Hebrew staff notifications for duty manager (Adir) — clear, professional, actionable.

import { buildStaffAppDeepLink, guestAlertTypeLabelHe, phoneDigitsForDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  composeFromStaffTemplate,
  STAFF_TEMPLATE_KEYS,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

export { guestAlertTypeLabelHe };

/** human_request_type → Hebrew label for soft Inbox handoffs. */
export const HANDOFF_TYPE_LABEL_HE: Record<string, string> = {
  staff_handoff:       "בקשה כללית מהאורח",
  date_change:         "שינוי תאריך / צ׳ק-אאוט",
  financial_issue:     "נושא חיוב",
  callback:            "בקשה לחזרה טלפונית",
  call:                "בקשה לשיחה",
  chat:                "שיחה פתוחה",
  guest_alert:         "התראת אורח",
  fallback_no_match:   "פנייה שלא סווגה",
  operational_request: "בקשת שירות בחדר",
};

export function handoffTypeLabelHe(type: string | null | undefined): string {
  const key = String(type ?? "").trim();
  return HANDOFF_TYPE_LABEL_HE[key] ?? "פנייה מהאורח";
}

export function formatAdirGuestLabel(
  name?: string | null,
  room?: string | null,
): string {
  const who = name?.trim() || "אורח";
  const suite = room?.trim() || "—";
  return `${who} (${suite})`;
}

export function buildGuestAlertSlaEscalationText(opts: {
  ageMinutes: number;
  thresholdMinutes: number;
  guestLabel: string;
  alertType: string;
  message: string;
  phone?: string | null;
  guestName?: string | null;
  futureArrivalNote?: string | null;
  templates?: StaffTemplateMap;
}): string {
  const typeLabel = guestAlertTypeLabelHe(opts.alertType);
  const digits = phoneDigitsForDeepLink(opts.phone);
  const inboxLine = digits
    ? `💬 שיחה: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: digits, guestName: opts.guestName })}`
    : "";
  const fromDb = composeFromStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ADIR_GUEST_ALERT_SLA, {
    age_minutes: opts.ageMinutes,
    threshold_minutes: opts.thresholdMinutes,
    guest_label: opts.guestLabel,
    alert_type_label: typeLabel,
    message: opts.message,
    inbox_line: inboxLine,
    requests_board_link: buildStaffAppDeepLink({ page: "requests_board" }),
    future_note: opts.futureArrivalNote?.trim() ? `\n${opts.futureArrivalNote.trim()}` : "",
  });
  if (fromDb) return fromDb;

  const lines = [
    "⚠️ בקשת אורח ממתינה יותר מדי",
    `עברו ${opts.ageMinutes} דק׳ (המקסימום: ${opts.thresholdMinutes} דק׳).`,
    "",
    `👤 ${opts.guestLabel}`,
    `📌 ${typeLabel}`,
    `💬 «${opts.message}»`,
    "",
    "👉 מה לעשות:",
    "ענה לאורח או סגור את הבקשה בלוח הבקשות.",
  ];
  if (digits) lines.push(inboxLine);
  lines.push(`📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`);
  if (opts.futureArrivalNote?.trim()) lines.push("", opts.futureArrivalNote.trim());
  return lines.join("\n");
}

export function buildPreCheckinGuestRequestAdirText(opts: {
  room: string;
  guestName?: string | null;
  summary: string;
  futureTag?: string | null;
  arrivingToday?: boolean;
  templates?: StaffTemplateMap;
}): string {
  const who = opts.guestName?.trim() || "אורח";
  const timing = opts.futureTag?.trim()
    ?? (opts.arrivingToday ? "מגיעים היום — עדיין לא נכנסו לסוויטה." : "");
  const fromDb = composeFromStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ADIR_PRE_CHECKIN, {
    room: opts.room,
    guest_name: who,
    summary: opts.summary.trim(),
    timing_line: timing,
    requests_board_link: buildStaffAppDeepLink({ page: "requests_board" }),
  });
  if (fromDb) return fromDb;

  const lines = [
    "🌴 בקשה מאורח לפני צ׳ק-אין",
    "",
    `🏨 ${opts.room} | 👤 ${who}`,
    `💬 ${opts.summary.trim()}`,
  ];
  if (timing) lines.push(timing);
  lines.push(
    "",
    "👉 מה לעשות:",
    "זו התראה מוקדמת — הבקשה כבר בלוח הבקשות.",
    "אפשר לתאם מראש לפני ההגעה.",
    "",
    `📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`,
  );
  return lines.join("\n");
}

export function buildPortalOrderAdirText(opts: {
  guestName?: string | null;
  room?: string | null;
  itemLines: string;
  arrivalTag?: string | null;
  templates?: StaffTemplateMap;
}): string {
  const who = opts.guestName?.trim() || "אורח";
  const room = opts.room?.trim();
  const guestHeader = room ? `👤 ${who} | 🏨 ${room}` : `👤 ${who}`;
  const fromDb = composeFromStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ADIR_PORTAL_ORDER, {
    guest_header: guestHeader,
    item_lines: opts.itemLines.trim(),
    arrival_tag: opts.arrivalTag?.trim() ?? "",
  });
  if (fromDb) return fromDb;

  const lines = [
    "🛎️ הזמנה חדשה מהפורטל",
    "",
    guestHeader,
    opts.itemLines.trim(),
  ];
  if (opts.arrivalTag?.trim()) lines.push(opts.arrivalTag.trim());
  lines.push(
    "",
    "👉 מה לעשות:",
    "בדוק בלוח התפעול או בלשונית ההזמנות במערכת.",
  );
  return lines.join("\n");
}

export function buildInventorySubmitAdirText(opts: {
  locationName: string;
  itemCount: number;
  templates?: StaffTemplateMap;
}): string {
  const fromDb = composeFromStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ADIR_INVENTORY, {
    location_name: opts.locationName,
    item_count: opts.itemCount,
    agent_link: buildStaffAppDeepLink({ page: "agent" }),
  });
  if (fromDb) return fromDb;

  return [
    "📦 דוח מלאי חדש ממתין לאישור",
    "",
    `📍 ${opts.locationName}`,
    `${opts.itemCount} פריטים דווחו`,
    "",
    "👉 מה לעשות:",
    "פתח את תור אישורי המלאי במערכת ואשר או דחה.",
    "",
    `📦 מלאי ואישורים: ${buildStaffAppDeepLink({ page: "agent" })}`,
  ].join("\n");
}
