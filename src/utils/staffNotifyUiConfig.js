// UI metadata for StaffNotifyPanel — placeholders & digest field labels.

export const STAFF_DIGEST_FIELD_LABELS = {
  adir_morning_brief: {
    greeting: "פתיחה",
    title: "כותרת ({{date_he}})",
    snapshot: "שורת מבט ({{today_total}}, {{missing_time}}, {{open_summary}})",
    eta_note: "שורת שעות הגעה ({{eta_count}})",
    tomorrow_note: "שורת מחר ({{tomorrow_total}})",
    missing_time_cta: "הצעה לבקש שעות ({{missing_time}})",
    open_header: "כותרת בקשות פתוחות",
    power_hints: "בלוק «מה אפשר לבקש»",
  },
  eliad_digest_shell: {
    opening_line: "שורת פתיחה ({{name}})",
    period_line: "כותרת תקופה ({{period_he}}, {{period_label}})",
    sla_label: "תווית עמידה ביעדי זמן",
    footer_1: "שורת פוטר 1",
    footer_2: "שורת פוטר 2",
    action_hint_quiet: "רמז פעולה כשהכל שקט",
  },
};

export const STAFF_TEMPLATE_PLACEHOLDERS = {
  adir_arrival_eta: ["headline", "guest_name", "room", "date_label", "time_line", "channel_label", "quote_line", "inbox_line", "requests_board_link"],
  adir_guest_alert_sla: ["age_minutes", "threshold_minutes", "guest_label", "alert_type_label", "message", "inbox_line", "requests_board_link", "future_note"],
  adir_pre_checkin_request: ["room", "guest_name", "summary", "timing_line", "requests_board_link"],
  adir_portal_order: ["guest_header", "item_lines", "arrival_tag"],
  adir_inventory_submit: ["location_name", "item_count", "agent_link"],
  adir_soft_handoff: ["age_minutes", "guest_label", "request_type_label", "preview", "inbox_line", "requests_board_link"],
  adir_onboarding: ["requests_board_link", "inbox_link"],
};

export const CHANNEL_HINT_LABELS = {
  whapi: "מכשיר סוויטות (Whapi)",
  meta: "Dream Bot (Meta)",
};

export const FRONT_DESK_ONBOARDING_CONFIG_KEY = "front_desk_onboarding_sent";
