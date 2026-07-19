// bot_config.restaurant_kiosk_ui — Armonim kiosk copy + shift manager PIN.

export const BOT_CONFIG_RESTAURANT_KIOSK_UI_KEY = "restaurant_kiosk_ui";

/** Canonical Armonim website menu page (guest QR + kiosk link). */
export const ARMONIM_EXTERNAL_MENU_URL = "https://armmonim.co.il/תפריט/";

export const DEFAULT_RESTAURANT_KIOSK_UI = Object.freeze({
  welcome_line: "ברוכים הבאים למשמרת ערב",
  evening_hours_line: "שירות ערב — תיאום שעות ארוחה",
  kosher_badge: true,
  external_menu_url: ARMONIM_EXTERNAL_MENU_URL,
  shift_manager_pin: "",
  wa_signature: "צוות מסעדת ערמונים",
});

export function normalizeRestaurantKioskUi(raw) {
  const d = DEFAULT_RESTAURANT_KIOSK_UI;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    welcome_line: String(raw.welcome_line ?? d.welcome_line).trim() || d.welcome_line,
    evening_hours_line: String(raw.evening_hours_line ?? d.evening_hours_line).trim() || d.evening_hours_line,
    kosher_badge: raw.kosher_badge !== false,
    external_menu_url: String(raw.external_menu_url ?? d.external_menu_url).trim() || d.external_menu_url,
    shift_manager_pin: String(raw.shift_manager_pin ?? "").trim(),
    wa_signature: String(raw.wa_signature ?? d.wa_signature).trim() || d.wa_signature,
  };
}

export function serializeRestaurantKioskUi(config) {
  return JSON.stringify(normalizeRestaurantKioskUi(config));
}
