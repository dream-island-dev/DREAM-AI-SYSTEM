// supabase/functions/_shared/adirNotifyMessages.ts
// Hebrew staff notifications for duty manager (Adir) — clear, professional, actionable.

import { buildStaffAppDeepLink, guestAlertTypeLabelHe, phoneDigitsForDeepLink } from "./guestAlertWhapiNotify.ts";

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
}): string {
  const typeLabel = guestAlertTypeLabelHe(opts.alertType);
  const digits = phoneDigitsForDeepLink(opts.phone);
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
  if (digits) {
    lines.push(
      `💬 שיחה: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: digits, guestName: opts.guestName })}`,
    );
  }
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
}): string {
  const who = opts.guestName?.trim() || "אורח";
  const timing = opts.futureTag?.trim()
    ?? (opts.arrivingToday ? "מגיעים היום — עדיין לא נכנסו לסוויטה." : "");
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
}): string {
  const who = opts.guestName?.trim() || "אורח";
  const room = opts.room?.trim();
  const lines = [
    "🛎️ הזמנה חדשה מהפורטל",
    "",
    room ? `👤 ${who} | 🏨 ${room}` : `👤 ${who}`,
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
}): string {
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
