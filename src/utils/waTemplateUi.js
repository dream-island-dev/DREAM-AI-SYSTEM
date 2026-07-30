// Shared Meta template list helpers (Inbox NewChatModal + GuestOutboundModal).

export const SERVICE_FALLBACK_TEMPLATE = "dream_service_fallback";

export const TEMPLATE_ORDER = [
  "dream_arrival_confirmation",
  "suite_welcome_morning",
  "dream_payment_and_workshops",
  "dream_mid_stay_check",
  "dream_checkout_feedback",
  "dream_checkin_reminder_v2",
  "dream_handover_agent_v2",
  "dream_service_fallback",
];

export function substituteTemplateVars(bodyText, varValues) {
  if (!bodyText) return "";
  let text = bodyText;
  (varValues ?? []).forEach((v, i) => {
    text = text.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), v || `{{${i + 1}}}`);
  });
  return text;
}

export function buildWaTemplateOptions(waTemplates, dbTemplates) {
  const approvedWa = (waTemplates ?? []).filter((w) => w.name !== "hello_world");
  return approvedWa
    .map((w) => {
      const dbMatch = (dbTemplates ?? []).find((d) => d.wa_template_name === w.name);
      return {
        ...w,
        source: "wa",
        displayName: dbMatch?.label ?? w.name,
      };
    })
    .sort((a, b) => {
      const ia = TEMPLATE_ORDER.indexOf(a.name);
      const ib = TEMPLATE_ORDER.indexOf(b.name);
      if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
}

export function autoFillGuestTemplateVars(guest, varCount, manualValues = []) {
  return Array.from({ length: varCount }, (_, idx) => {
    const manual = manualValues[idx]?.trim();
    if (manual) return manual;
    if (idx === 0) return guest?.name ?? "";
    if (idx === 1) return guest?.room ?? "";
    if (idx === 2) return guest?.arrival_date ?? "";
    return "";
  });
}

export const TEMPLATE_VAR_LABELS = ["שם אורח", "מספר חדר", "תאריך הגעה", "סוג חדר", "שעת הגעה"];
