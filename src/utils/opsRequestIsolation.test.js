/**
 * Mirrors _shared/automationSchedule.ts's physical-task allowlist gate and
 * the new extractAllowlistedRequestLines() burst-isolation helper (Deno
 * boundary — duplicated, not imported, same convention as guestOpsRouting.test.js).
 * Keep in sync when the allowlist/isolation logic changes.
 */

const INFORMATIONAL_GUEST_QUERY_PATTERN =
  /(?:^|[\s,.!?])(?:מה|מתי|איפה|היכן|כמה|האם|איז(?:ה|ו)|מי)\b|(?:ה(?:יתה|יה)\s+פעם|פעם\s+ה(?:יתה|יה))|(?:ממוקמת|ממוקם|איפה\s+(?:ה(?:יא|וא)|נמצא)|היכן\s+(?:ה(?:יא|וא)|נמצא))|(?:שעות(?:\s*פתיחה)?|עד\s+מתי|checkout|צ.?ק.?אא?וט|בר(?:יכה|\s)?|עמד(?:ת|ה)|ברד|slushie|wifi|wi-fi|אינטרנט|מסעד(?:ה|ת)|חניה)/iu;

const PHYSICAL_REQUEST_INTENT_PATTERN =
  /אפשר|אפשרו|בבקשה|צר[י]כ[הים]?|חסר|חסרה|תביאו|תביא|שלחו|שלח|מבקש|מבקשת|נוכל\s+לקבל|אפשר\s+לקבל|אשמח|דחוף|עזרו|עזרה|העבר|העבירו|עוד\s+(?:של|מ)|תוסיפו|need|please\s+(?:send|bring)|can\s+(?:i|we)\s+get/u;

const ALLOWLIST_AMENITY_PATTERN =
  /(?:חלב|קפה|מגבות|שמפו|סבון|נייר(?:\s*טואלט)?|חלוק(?:ים)?|כרית(?:ות)?|שמיכ(?:ה|ות)?|קפסולות|(?<![א-ת])קרח(?![א-ת])|\bice\b)/iu;

// Fixed session 2026-07-07 — see automationSchedule.ts for the full incident
// writeup. JS `\b` never matches Hebrew letters, so bare "מים" used to match
// as a substring of unrelated words like "בפעמים" (times/occasions) — the
// confirmed, exact root cause of the "אמרו לנו שאפשר ב-11 כמו שהיה בפעמים
// הקודמות" false-positive. The lookaround allows a real word boundary OR
// one of the standard single-letter Hebrew prefixes (ה/ו/ש/ב/כ/ל/מ) so
// legitimate glued forms ("המים"/"ומים"/"למים") still match.
const ALLOWLIST_BOTTLED_WATER_PATTERN =
  /(?:בבקשה\s+)?(?:עוד\s+)?(?:(?<![א-ת])|(?<=(?<![א-ת])[הושבכלמ]))מים(?![א-ת])(?:\s+(?:לחדר|בחדר|לסוויטה|בסוויטה|קר(?:ים|ות)|מינר(?:ל|al)))?/u;

// Tightened session 2026-07-07: trailing bare fault-word alternative now
// requires a nearby device/room noun (gap-tolerant [\s\S]{0,25}), mirroring
// SENSITIVE_STAY_CHANGE_PATTERN's session-96 precedent. Bare "שלט" also
// got the same Hebrew word-boundary fix as "מים" above (collides with
// "שלטון"/government otherwise).
const ALLOWLIST_MAINTENANCE_PATTERN =
  /מזגן(?:\s*(?:לא\s+עובד|לא\s+מקרר|תקול|מקולקל))?|(?:טלו(?:ו)?יז(?:יה|יון)|(?:(?<![א-ת])|(?<=(?<![א-ת])[הושבכלמ]))שלט(?![א-ת])(?:\s*ט(?:לו(?:ו)?יז)?)?)(?:\s*(?:לא\s+עובד|תקוע|שבור))?|סתימה|(?:אין|לא\s+)מים\s+חמים|זרם\s+חלש|אור\s*שבור|כספת\s*נעולה|דלת\s*לא\s*נפתח(?:ת)?|(?:לא\s+עובד(?:ת)?|תקלה|תקוע(?:ה)?|שבור(?:ה)?)[\s\S]{0,25}(?:מזגן|טלו(?:ו)?יז(?:יה|יון)|שלט|דלת|כספת|מים|אור|חדר|סוויטה|מקרר|מקלחת|ברז|חלון|תריס)|(?:מזגן|טלו(?:ו)?יז(?:יה|יון)|שלט|דלת|כספת|מים|אור|חדר|סוויטה|מקרר|מקלחת|ברז|חלון|תריס)[\s\S]{0,25}(?:לא\s+עובד(?:ת)?|תקלה|תקוע(?:ה)?|שבור(?:ה)?)/u;

const ALLOWLIST_CLEANING_PATTERN =
  /(?:ניקיון\s+חדר|לפנות\s+זבל|להחליף\s+מצעים|החלפת\s+מצעים|שטיפת\s+רצפה|פינוי\s+זבל)/u;

function isInformationalGuestQuery(text) {
  const t = text.trim();
  if (!t) return false;
  if (INFORMATIONAL_GUEST_QUERY_PATTERN.test(t)) return true;
  if (/\?\s*$/.test(t) && !PHYSICAL_REQUEST_INTENT_PATTERN.test(t) && !ALLOWLIST_MAINTENANCE_PATTERN.test(t)) {
    return true;
  }
  return false;
}

function isAllowlistedPhysicalTaskRequest(text) {
  const t = text.trim();
  if (!t || isInformationalGuestQuery(t)) return false;

  if (ALLOWLIST_MAINTENANCE_PATTERN.test(t)) {
    if (/^(?:מתי|איפה|היכן|מה|כמה|האם)\b/u.test(t) && !/(?:לא\s+עובד|תקול|שבור|סתימה|תקוע)/u.test(t)) {
      return false;
    }
    return true;
  }

  if (ALLOWLIST_CLEANING_PATTERN.test(t)) {
    return PHYSICAL_REQUEST_INTENT_PATTERN.test(t) || /(?:לחדר|לסוויטה|בחדר|בסוויטה)/u.test(t);
  }

  if (ALLOWLIST_AMENITY_PATTERN.test(t) || ALLOWLIST_BOTTLED_WATER_PATTERN.test(t)) {
    return PHYSICAL_REQUEST_INTENT_PATTERN.test(t)
      || /(?:לחדר|לסוויטה|בחדר|בסוויטה|עוד\s+)/u.test(t);
  }

  return false;
}

function extractAllowlistedRequestLines(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return text.trim();
  const relevant = lines.filter((line) => isAllowlistedPhysicalTaskRequest(line));
  if (relevant.length === 0) return text.trim();
  return relevant.join("\n");
}

describe("reported incident — root cause fixed at the source", () => {
  test("the exact ambiguous sentence no longer matches the allowlist at all", () => {
    expect(isAllowlistedPhysicalTaskRequest("אמרו לנו שאפשר ב-11 כמו שהיה בפעמים הקודמות")).toBe(false);
  });

  test("a similar burst (unrelated ambiguous line + genuine request) still isolates correctly", () => {
    const burst = "אפשר מגבות בבקשה\nאמרו לנו שאפשר ב-11 כמו שהיה בפעמים הקודמות";
    expect(extractAllowlistedRequestLines(burst)).toBe("אפשר מגבות בבקשה");
  });
});

describe("ALLOWLIST_BOTTLED_WATER_PATTERN — Hebrew word-boundary fix", () => {
  test("מים embedded in an unrelated word (בפעמים/times) no longer matches", () => {
    expect(ALLOWLIST_BOTTLED_WATER_PATTERN.test("בפעמים הקודמות")).toBe(false);
    expect(ALLOWLIST_BOTTLED_WATER_PATTERN.test("תודה על הפעמיים שעזרתם")).toBe(false);
  });

  test("bare מים and legitimate single-letter-prefixed forms still match", () => {
    expect(ALLOWLIST_BOTTLED_WATER_PATTERN.test("מים")).toBe(true);
    expect(ALLOWLIST_BOTTLED_WATER_PATTERN.test("המים קרים בבקשה")).toBe(true);
    expect(ALLOWLIST_BOTTLED_WATER_PATTERN.test("קפה ומים בבקשה")).toBe(true);
    expect(isAllowlistedPhysicalTaskRequest("אפשר לקבל מים לחדר")).toBe(true);
  });
});

describe("ALLOWLIST_MAINTENANCE_PATTERN — tightening + word-boundary fix", () => {
  test("bare fault word with no nearby device/room noun no longer matches", () => {
    expect(ALLOWLIST_MAINTENANCE_PATTERN.test("הקישור לתשלום לא עובד")).toBe(false);
    expect(ALLOWLIST_MAINTENANCE_PATTERN.test("הייתה תקלה בהזמנה שלי")).toBe(false);
  });

  test("device noun within the gap-tolerant window still matches", () => {
    expect(ALLOWLIST_MAINTENANCE_PATTERN.test("המזגן תקוע")).toBe(true);
    expect(ALLOWLIST_MAINTENANCE_PATTERN.test("יש תקלה במזגן")).toBe(true);
  });

  test("lone device-first alternative (מזגן לא עובד) still matches unconditionally", () => {
    expect(isAllowlistedPhysicalTaskRequest("המזגן לא עובד")).toBe(true);
  });

  test("שלט embedded in an unrelated word (שלטון/government) no longer matches", () => {
    expect(ALLOWLIST_MAINTENANCE_PATTERN.test("השלטון לא הגיב לפנייה שלנו")).toBe(false);
  });

  test("legitimate remote-control requests still match", () => {
    expect(isAllowlistedPhysicalTaskRequest("אין לי שלט בחדר")).toBe(true);
    expect(isAllowlistedPhysicalTaskRequest("השלט לא עובד")).toBe(true);
  });

  test("ice request matches amenity allowlist (live 2026-07-18)", () => {
    expect(isAllowlistedPhysicalTaskRequest("אפשר עוד קרח")).toBe(true);
    expect(isAllowlistedPhysicalTaskRequest("can we get ice please")).toBe(true);
  });
});

describe("extractAllowlistedRequestLines — burst isolation", () => {
  test("single-line input is a no-op passthrough", () => {
    expect(extractAllowlistedRequestLines("המזגן לא עובד בחדר")).toBe("המזגן לא עובד בחדר");
  });

  test("all lines relevant — keeps and joins all of them", () => {
    const burst = "אפשר מגבות בבקשה\nהמזגן לא עובד בחדר";
    expect(extractAllowlistedRequestLines(burst)).toBe(burst);
  });

  test("zero lines relevant — falls back to the full original blob", () => {
    const burst = "תודה רבה\nמה שעות הבריכה";
    expect(extractAllowlistedRequestLines(burst)).toBe(burst);
  });

  test("relevant line in the middle/last position of a 3+ line burst is still isolated", () => {
    const burst = "היי\nמה שעות הבריכה\nאפשר מגבות בבקשה";
    expect(extractAllowlistedRequestLines(burst)).toBe("אפשר מגבות בבקשה");
  });
});
