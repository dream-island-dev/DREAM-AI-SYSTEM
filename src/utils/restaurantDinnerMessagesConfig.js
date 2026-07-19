// Default WA templates for Restaurant Dinner Board — bot_config.restaurant_dinner_messages

export const BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY = "restaurant_dinner_messages";

export const DINNER_MESSAGE_PLACEHOLDER_HELP = Object.freeze([
  { key: "{{greeting}}", label: "ברכה (היי + שם)" },
  { key: "{{name}}", label: "שם האורח" },
  { key: "{{slots}}", label: "שעות מוצעות (לשאלה)" },
  { key: "{{time}}", label: "שעת ערב (לאישור)" },
  { key: "{{location}}", label: "מיקום / מסעדה" },
]);

export const DEFAULT_RESTAURANT_DINNER_MESSAGES = Object.freeze({
  ask_template:
    "{{greeting}} 🍽️\nלמתי תרצו לקבוע את ארוחת הערב ב{{location}}?\nאפשר {{slots}} — או כתבו לנו שעה אחרת שמתאימה לכם.\nתודה!",
  ask_template_no_slots:
    "{{greeting}} 🍽️\nלמתי תרצו לקבוע את ארוחת הערב ב{{location}}?\nכתבו לנו שעה שמתאימה לכם — נשמח לתאם.\nתודה!",
  confirm_template:
    "{{greeting}} 🍽️\nשמרנו לכם שולחן לארוחת ערב ב-{{time}} ב{{location}}.\nנתראה!",
  confirm_template_no_time:
    "{{greeting}} 🍽️\nשמרנו לכם שולחן לארוחת ערב ב{{location}}.\nנתראה!",
  custom_template: "{{greeting}} 🍽️\n",
  offer_slots: Object.freeze(["19:00", "19:30", "20:00", "20:30"]),
  default_ask_slots: Object.freeze(["19:00", "19:30", "20:00"]),
});

function plainDefaults() {
  return {
    ask_template: DEFAULT_RESTAURANT_DINNER_MESSAGES.ask_template,
    ask_template_no_slots: DEFAULT_RESTAURANT_DINNER_MESSAGES.ask_template_no_slots,
    confirm_template: DEFAULT_RESTAURANT_DINNER_MESSAGES.confirm_template,
    confirm_template_no_time: DEFAULT_RESTAURANT_DINNER_MESSAGES.confirm_template_no_time,
    custom_template: DEFAULT_RESTAURANT_DINNER_MESSAGES.custom_template,
    offer_slots: [...DEFAULT_RESTAURANT_DINNER_MESSAGES.offer_slots],
    default_ask_slots: [...DEFAULT_RESTAURANT_DINNER_MESSAGES.default_ask_slots],
  };
}

function normalizeSlotList(raw, fallback) {
  if (!Array.isArray(raw)) return [...fallback];
  const slots = raw.map((s) => String(s).trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  return slots.length ? slots : [...fallback];
}

export function normalizeRestaurantDinnerMessages(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const base = plainDefaults();
  if (!parsed || typeof parsed !== "object") return base;

  const p = parsed;
  base.ask_template = String(p.ask_template ?? base.ask_template).trim() || base.ask_template;
  base.ask_template_no_slots = String(p.ask_template_no_slots ?? base.ask_template_no_slots).trim() || base.ask_template_no_slots;
  base.confirm_template = String(p.confirm_template ?? base.confirm_template).trim() || base.confirm_template;
  base.confirm_template_no_time = String(p.confirm_template_no_time ?? base.confirm_template_no_time).trim() || base.confirm_template_no_time;
  base.custom_template = String(p.custom_template ?? base.custom_template).trim() || base.custom_template;
  base.offer_slots = normalizeSlotList(p.offer_slots, DEFAULT_RESTAURANT_DINNER_MESSAGES.offer_slots);
  base.default_ask_slots = normalizeSlotList(p.default_ask_slots, DEFAULT_RESTAURANT_DINNER_MESSAGES.default_ask_slots);
  return base;
}

export function serializeRestaurantDinnerMessages(config) {
  return JSON.stringify(normalizeRestaurantDinnerMessages(config));
}

export function formatSlotsHebrew(slots) {
  const times = (slots ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!times.length) return "";
  if (times.length === 1) return `בשעה ${times[0]}`;
  if (times.length === 2) return `ב-${times[0]} או ב-${times[1]}`;
  const last = times[times.length - 1];
  const rest = times.slice(0, -1).join(", ");
  return `${rest} או ב-${last}`;
}

export function buildDinnerMessageVars({ guestName, slots, time, location }) {
  const name = String(guestName ?? "").trim();
  const loc = String(location ?? "מסעדת ערמונים").trim() || "מסעדת ערמונים";
  return {
    name,
    greeting: name ? `היי ${name}` : "היי",
    slots: formatSlotsHebrew(slots),
    time: String(time ?? "").trim(),
    location: loc,
  };
}

export function renderDinnerMessageTemplate(template, vars) {
  let out = String(template ?? "");
  const entries = Object.entries(vars ?? {});
  for (const [key, val] of entries) {
    out = out.split(`{{${key}}}`).join(String(val ?? ""));
  }
  return out.trim();
}

export function composeAskMessage(config, { guestName, slots, location }) {
  const cfg = normalizeRestaurantDinnerMessages(config);
  const vars = buildDinnerMessageVars({ guestName, slots, location });
  const tpl = vars.slots ? cfg.ask_template : cfg.ask_template_no_slots;
  return renderDinnerMessageTemplate(tpl, vars);
}

export function composeConfirmMessage(config, { guestName, time, location }) {
  const cfg = normalizeRestaurantDinnerMessages(config);
  const vars = buildDinnerMessageVars({ guestName, time, location });
  const tpl = vars.time ? cfg.confirm_template : cfg.confirm_template_no_time;
  return renderDinnerMessageTemplate(tpl, vars);
}

export function composeCustomMessage(config, { guestName, location }) {
  const cfg = normalizeRestaurantDinnerMessages(config);
  const vars = buildDinnerMessageVars({ guestName, location });
  return renderDinnerMessageTemplate(cfg.custom_template, vars);
}

export function cloneDefaultRestaurantDinnerMessages() {
  return plainDefaults();
}
