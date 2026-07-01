// src/utils/receptionChecklistTemplate.js
// Verbatim task strings from physical reception daily checklist (1000164450.jpg).
// Seeded per checklist_date on first open; shift rolls at 04:00 Asia/Jerusalem.

export const RECEPTION_CHECKLIST_SECTIONS = [
  { key: "opening", label: "משמרת פתיחה" },
  { key: "ongoing", label: "משימות שוטפות" },
  { key: "evening", label: "משימות ערב" },
];

/** @type {{ section: string; key: string; label: string; sort: number }[]} */
export const RECEPTION_CHECKLIST_TEMPLATE = [
  // ── משמרת פתיחה (6) ──
  {
    section: "opening",
    key: "open_callcenter_chargers",
    label:
      "לוודא שהקול סנטר פעיל לשיחות מהמרכז הזמנות ושכל מכשירי הסליקות+הטלפון סוויטות טעונים (מגיעים בבוקר להוציא את המטען ולהכניס בחזרה שתדלק נורה אדומה בסולק!)",
    sort: 10,
  },
  {
    section: "opening",
    key: "open_breakfast_sheet",
    label: "להדפיס דף ארוחות בוקר למארחת",
    sort: 20,
  },
  {
    section: "opening",
    key: "open_departures_arrivals_sheet",
    label: "להכין דף עזיבות והגעה לסוויטות בדגש על תוספת תשלום.",
    sort: 30,
  },
  {
    section: "opening",
    key: "open_stations_tidy",
    label: "לוודא שהעמדות מסודרות .",
    sort: 40,
  },
  {
    section: "opening",
    key: "open_daily_schedule_print",
    label: "הדפסת לוז יומי לכל עמדה –מאיפה כל קבוצה נכנסת במהלך הצק אין",
    sort: 50,
  },
  {
    section: "opening",
    key: "open_locker_bracelets",
    label:
      "להכין צמידים של לוקרים לכל הסוויטות שעושות צ'ק אאוט מראש! (להצמיד פתק אם מספר הסוויטה).",
    sort: 60,
  },

  // ── משימות שוטפות (5) ──
  {
    section: "ongoing",
    key: "ongoing_tv_names_11",
    label: "להכניס שמות לטלוויזיה בשעה 11:00כשהסוויטות מבצעות צק אאוט!",
    sort: 10,
  },
  {
    section: "ongoing",
    key: "ongoing_tomorrow_schedule",
    label: "להכין לוז יומי ליום שלמחרת.",
    sort: 20,
  },
  {
    section: "ongoing",
    key: "ongoing_voucher_report",
    label: "דוח שוברים.",
    sort: 30,
  },
  {
    section: "ongoing",
    key: "ongoing_morning_cash_close",
    label: "סגירת קופות משמרת בוקר !! כולל חתימות",
    sort: 40,
  },
  {
    section: "ongoing",
    key: "ongoing_tomorrow_orders_vouchers",
    label: "מעבר על הזמנות של יום אחרי –בדיקה של שוברים שיהיו תואמים להזמנה",
    sort: 50,
  },

  // ── משימות ערב (10) ──
  {
    section: "evening",
    key: "eve_forecast_21",
    label: "לשלוח דוח צפי מעודכן ליום למחרת בשעה 21:00.",
    sort: 10,
  },
  {
    section: "evening",
    key: "eve_group_bracelets",
    label: "הכנת צמידים לקבוצות ליום למחרת ולכתוב פתק עם שם הקבוצה, ושעה של ארוחה.",
    sort: 20,
  },
  {
    section: "evening",
    key: "eve_green_dollar_checkout",
    label: "מעבר על הדולר הירוק ולוודא שכל ההזמנות בצ'ק אאוט.",
    sort: 30,
  },
  {
    section: "evening",
    key: "eve_filing_binders",
    label: "לתייק לקלסרים את טפסי קבלת הסוויטות, חשבוניות ודוח קריאות.",
    sort: 40,
  },
  {
    section: "evening",
    key: "eve_credit_z_report",
    label: "סליקות אשראי- בדיקה מול דוח Z ודוח סליקות.",
    sort: 50,
  },
  {
    section: "evening",
    key: "eve_lilach_z_safe",
    label:
      "לשלוח ללילך את הדוח במייל ולהדפיס דוח Z נוסף ולהכניס לכספת במשרד של אליעד. בשעה- 22:00.",
    sort: 60,
  },
  {
    section: "evening",
    key: "eve_evening_cash_close",
    label: "סגירת קופה משמרת ערב",
    sort: 70,
  },
  {
    section: "evening",
    key: "eve_attendance_email",
    label: "לשלוח דוח נוכחות לענבל ואוסנת בסוף משמרת – במייל.",
    sort: 80,
  },
  {
    section: "evening",
    key: "eve_voucher_redemption_after_midnight",
    label: "מימוש שוברים ליום למחרת אחרי השעה 00:00!",
    sort: 90,
  },
  {
    section: "evening",
    key: "eve_keys_audit",
    label: "בדיקת מפתחות חדש ובמדיה וחסר , איזה מפתח חסר",
    sort: 100,
  },
];

export const RECEPTION_CHECKLIST_FOOTER =
  'בסוף כל משמרת יש לוודא שכל המשימות בוצעו ונרשמו ע"י מי ולהשאיר את הדף על השולחן של ילנה.';

export function templateRowKey(section, key) {
  return `${section}:${key}`;
}

export function buildTemplateKeySet() {
  return new Set(
    RECEPTION_CHECKLIST_TEMPLATE.map((t) => templateRowKey(t.section, t.key)),
  );
}

const OPERATOR_STORAGE_KEY = "reception_checklist_operator";

export function readStoredOperatorName() {
  try {
    return localStorage.getItem(OPERATOR_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function writeStoredOperatorName(name) {
  try {
    localStorage.setItem(OPERATOR_STORAGE_KEY, name);
  } catch {
    /* ignore */
  }
}

function suppressedStorageKey(date) {
  return `reception_checklist_suppressed_${date}`;
}

export function readSuppressedTemplateKeys(date) {
  try {
    const raw = localStorage.getItem(suppressedStorageKey(date));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function writeSuppressedTemplateKeys(date, keys) {
  try {
    localStorage.setItem(suppressedStorageKey(date), JSON.stringify([...keys]));
  } catch {
    /* ignore */
  }
}

export function addSuppressedTemplateKey(date, section, key) {
  const set = readSuppressedTemplateKeys(date);
  set.add(templateRowKey(section, key));
  writeSuppressedTemplateKeys(date, set);
}

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
