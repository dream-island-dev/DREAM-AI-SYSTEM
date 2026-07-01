// src/utils/receptionChecklistTemplate.js
// Boilerplate rows for ReceptionChecklist — seeded per checklist_date on first open.

export const RECEPTION_CHECKLIST_SECTIONS = [
  { key: "opening", label: "🌅 משמרת פתיחה", icon: "🌅" },
  { key: "ongoing", label: "🔄 משימות שוטפות", icon: "🔄" },
  { key: "evening", label: "🌌 משימות ערב", icon: "🌌" },
];

/** @type {{ section: string; key: string; label: string; sort: number }[]} */
export const RECEPTION_CHECKLIST_TEMPLATE = [
  { section: "opening", key: "open_cash", label: "פתיחת קופה + ספירת כסף פתיחה", sort: 10 },
  { section: "opening", key: "open_keys", label: "בדיקת מפתחות / כרטיסי חדר", sort: 20 },
  { section: "opening", key: "open_lobby", label: "סיור לובי + שולחן קבלה מסודר", sort: 30 },
  { section: "opening", key: "open_systems", label: "הפעלת מערכות (טלפון, מדפסת, Dream Bot)", sort: 40 },
  { section: "opening", key: "open_arrivals", label: "סקירת הגעות היום + הכנת מפתחות", sort: 50 },

  { section: "ongoing", key: "ongoing_inbox", label: "מעקב DREAM BOT + מענה אורחים", sort: 10 },
  { section: "ongoing", key: "ongoing_calls", label: "טיפול בקריאות נכנסות / בקשות אורח", sort: 20 },
  { section: "ongoing", key: "ongoing_spa", label: "תיאום ספא + עדכון שעות טיפול", sort: 30 },
  { section: "ongoing", key: "ongoing_hk", label: "תיאום עם משק בית לחדרים מוכנים", sort: 40 },
  { section: "ongoing", key: "ongoing_vip", label: "בדיקת VIP / אירועים מיוחדים", sort: 50 },

  { section: "evening", key: "eve_arrivals", label: "צ'ק-אין ערב + מסירת מפתחות", sort: 10 },
  { section: "evening", key: "eve_tomorrow", label: "הכנת רשימת הגעות למחר", sort: 20 },
  { section: "evening", key: "eve_handover", label: "מסירת משמרת למנהל ערב (סיכום)", sort: 30 },
  { section: "evening", key: "eve_cash", label: "סגירת קופה + דוח יומי", sort: 40 },
  { section: "evening", key: "eve_secure", label: "נעילת קבלה + כיבוי ציוד", sort: 50 },
];

/** Israel shift date — rolls back before 04:00 (fresh morning boilerplate). */
export function receptionChecklistShiftDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  let y = Number(get("year"));
  let m = Number(get("month"));
  let d = Number(get("day"));
  const hour = Number(get("hour"));
  if (hour < 4) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
