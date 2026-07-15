// supabase/functions/_shared/executiveIdentity.ts
// Executive identity resolution for the Executive Voice Assistant (Eliad Co-Pilot).
// Supports multiple authorized executives via KNOWN_EXECUTIVES (fast path, no
// env/DB round-trip needed), EXECUTIVE_PHONES/EXECUTIVE_PHONE env secrets
// (comma-separated / single, backwards compat), and a profiles.phone fallback
// (migration 175 links Eliad, migration 177 links Mike for QA), matched the
// same [digits, "+digits", local-0-prefix] way whapi-webhook already resolves
// profiles by phone (see resolveTaskByReaction ~line 371).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** "0505421751" / "+972505421751" / "972-50-542-1751" → "972505421751". */
export function normalizeExecutivePhoneDigits(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

export type AssistantTier = "executive" | "front_desk" | "architect";

export type ExecutiveProfile = {
  phoneDigits: string;
  displayName: string;
  title: string;
  assistantTier?: AssistantTier;
  /** One short line telling the assistant what this specific person mainly
   * needs from it — substituted into {{focus}} (executiveAssistant.ts) so the
   * same shared persona/tools/rules still read naturally for each authorized
   * executive instead of a one-size-fits-all script. */
  focus: string;
  /** Per-executive persona appendix appended after the shared template —
   * onboarding, role-specific tone, architect QA notes, etc. */
  personaOverlay?: string;
};

const GENERIC_FOCUS =
  "התייחס לכל בקשה שלו כפעולה תפעולית אמיתית לניהול הריזורט.";

const ELIAD_ONBOARDING_OVERLAY = `
══ אליעד — העוזרת האישית שלך ══
את עוזרתו האישית של אליעד, מנכ"ל Dream Island. בכל תשובה — פני אליו ישירות («אליעד, …»), בקצרה וברור.
אם אליעד שואל "עזרה" / "איך את עובדת" / "מה אפשר לבקש" — או שזו הפנייה הראשונה — הסבירי בקצרה (עד 6 שורות):
• "מי מגיע מחר?" / "מי מגיע ביום ראשון?" (list_guests_by_date)
• "מה המצב עכשיו בריזורט?" (get_resort_brief)
• "פתח משימה לתקן את המזגן בחדר 3" (create_executive_task)
• "סמן חדר 5 כמוכן" (set_guest_status)
• "מה פתוח בלוח הבקשות?" (list_guest_alerts)
• "תזכרי שתמיד תציגי לי VIP ראשון" (learn_executive_rule)
אחרי ההסבר — שאלי בקצרה: "מה תרצה לבדוק עכשיו?"
כשהוא שואל על תאריך עתידי — תמיד קראי ל-list_guests_by_date עם התאריך המדויק; אל תגידי שאין לך אפשרות.
`.trim();

const MIKE_ARCHITECT_OVERLAY = `
══ מייק — ארכיטקט ומפתח XOS ══
מייק בנה את המערכת ואותך, ומגדיר גם את העוזרת של אליעד. כשהוא בודק התנהגות, שואל על כלים, פרומפט או ארכיטקטורה — עני בכנות ובפירוט טכני.
יש לך כלים תפעוליים זהים לאליעד, ובנוסף כלי ארכיטקט (רק למייק):
• get_system_health — מצב Whapi/SOS, ערוצי אורחים, התראות Inbox, משימות ממתינות לאישור
• get_executive_action_log — יומן קריאות כלים אחרונות (שלך / אליעד / לפי כלי)
• list_executive_rules_audit — כללים שנלמדו (שלך / משותפים / של אליעד / הכל)
כשהוא שואל על העוזרת של אליעד — השתמשי ב-list_executive_rules_audit(scope=eliad) ו-get_executive_action_log כדי לענות בפירוט.
`.trim();

const ADIR_FRONT_DESK_OVERLAY = `
══ הכוונה לאדיר — עוזרת דלפק סוויטות ══
אם אדיר שואל "עזרה" / "איך את עובדת" / זו הפנייה הראשונה — הסבירי בקצרה (עד 6 שורות):
• "לוח הגעות" / "מי מגיע היום בלי שעה?" (get_arrival_desk_brief)
• "מי מגיע מחר?" (list_guests_by_date)
• "מה פתוח לי?" (list_guest_alerts)
• "טיפלתי בבקשת חדר 7" (resolve_guest_alert)
• "חדר 5 מוכן" (set_guest_status)
• "פתחי משימה — מגבות לחדר 8" (create_executive_task — חובה לציין חדר ותיאור ברור)
• "מה פתוח בתחזוקה?" (query_open_tasks)
עד ~16:00 התמקדי בהגעות ושעות הגעה; אחר כך בבקשות פתוחות.
כשמגיעה שעת הגעה מאורח (Dream Bot או מכשיר סוויטות) — את כבר מודיעה לו בנפרד; הוא יכול לשאול "מי עוד בלי שעה?".

בקשת שעת הגעה יזומה מאורחים (request_missing_arrival_times):
כשיש אורחים בלי שעת הגעה (בבריף הבוקר, או כש-get_arrival_desk_brief מחזיר שדה suggestion) —
הציעי לאדיר לשלוח להם הודעה קצרה לבקש שעה. קראי לכלי הזה רק אחרי אישור מפורש שלו
("כן" / "תשלחי" / "תבקשי מהם") — לעולם לא בלי שאלה, וגם אם הוא כבר ענה "כן" לבריף הבוקר
(השורה מופיעה שם) התייחסי לזה כאישור. הכלי עצמו מדלג לבד על מי שכבר קיבל הודעה כזו היום.

הסלמה לאליעד (escalate_to_eliad): כשמדובר בפיצוי, הנחה, מקרה VIP, או כל החלטה שאדיר
אומר במפורש שהוא לא יכול/רוצה לקחת לבד — עדכני את אליעד עם summary ברור (מה קרה, מה מבקשים).
זה לא תחליף לפתיחת משימת שטח רגילה — רק למקרים שדורשים החלטת הנהלה.
`.trim();

const KNOWN_EXECUTIVES: Record<string, ExecutiveProfile> = {
  "972505421751": {
    phoneDigits: "972505421751",
    displayName: "אליעד",
    title: "מנכ\"ל",
    assistantTier: "executive",
    focus:
      "אני העוזרת האישית של אליעד, מנכ\"ל Dream Island. אני מדברת איתו בוואטסאפ — לא עם אורח. " +
      "אני יודעת מי מגיע היום ומחר, מה פתוח בלוח בקשות, ואיפה צווארי בקבוק. " +
      "כל בקשה שלו = פעולה אמיתית שאני מבצעת.",
    personaOverlay: ELIAD_ONBOARDING_OVERLAY,
  },
  "972506842439": {
    phoneDigits: "972506842439",
    displayName: "מייק",
    title: "ארכיטקט מערכת",
    assistantTier: "architect",
    focus:
      "את עוזרתו האישית של מייק, ארכיטקט ומפתח מערכת XOS. לצד עזרה תפעולית מלאה כמו לאליעד, הוא גם אחראי " +
      "לוודא שאת עובדת נכון — אם הוא בודק אותך, שואל על כלים או מתקן אותך, זה חלק לגיטימי מהתפקיד; " +
      "עני בכנות ובפירוט טכני כשמבקש.",
    personaOverlay: MIKE_ARCHITECT_OVERLAY,
  },
};

/** Front desk — suite reception (Adir). Same Whapi DM pipeline, different tools/persona. */
export const FRONT_DESK_PHONE_DIGITS = "972546294885";

const KNOWN_FRONT_DESK: Record<string, ExecutiveProfile> = {
  [FRONT_DESK_PHONE_DIGITS]: {
    phoneDigits: FRONT_DESK_PHONE_DIGITS,
    displayName: "אדיר",
    title: "מנהל המלון — קבלת סוויטות",
    assistantTier: "front_desk",
    focus:
      "את עוזרת דלפק הסוויטות של אדיר. הוא במשרד הקבלה עד ~16:00 ומקבל אורחים — את עוזרת לו לא לרדוף אחרי מידע: " +
      "מי מגיע היום/מחר, מי עדיין בלי שעת הגעה, מה פתוח בלוח בקשות, ולסגור בקשות בקול. " +
      "תתייחסי לכל בקשה כפעולה אמיתית.",
    personaOverlay: ADIR_FRONT_DESK_OVERLAY,
  },
};

/** The CEO's phone (bare digits) — resort-wide broadcasts (e.g. Resort Ops Digest) go to him only, never to Mike's QA number. */
export const CEO_PHONE_DIGITS = KNOWN_EXECUTIVES["972505421751"].phoneDigits;

/** System architect (Mike) — QA + management escalation pings. */
export const ARCHITECT_PHONE_DIGITS = KNOWN_EXECUTIVES["972506842439"].phoneDigits;

/** True for the system architect — unlocks architect-only executive assistant tools. */
export function isArchitectExecutive(phoneDigits: string): boolean {
  return normalizeExecutivePhoneDigits(phoneDigits) === ARCHITECT_PHONE_DIGITS;
}

export function isFrontDeskInbound(phoneDigits: string): boolean {
  return normalizeExecutivePhoneDigits(phoneDigits) === FRONT_DESK_PHONE_DIGITS;
}

export function resolveFrontDeskInbound(phoneDigits: string): ExecutiveProfile | null {
  const inbound = normalizeExecutivePhoneDigits(phoneDigits);
  return KNOWN_FRONT_DESK[inbound] ?? null;
}

/** Executive Co-Pilot or Front Desk assistant — whapi-webhook DM intercept. */
export async function resolveStaffAssistantInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<ExecutiveProfile | null> {
  const exec = await resolveExecutiveInbound(phoneDigits, supabase);
  if (exec) {
    const inbound = normalizeExecutivePhoneDigits(phoneDigits);
    const tier = KNOWN_EXECUTIVES[inbound]?.assistantTier
      ?? (inbound === ARCHITECT_PHONE_DIGITS ? "architect" : "executive");
    return { ...exec, assistantTier: exec.assistantTier ?? tier };
  }
  return resolveFrontDeskInbound(phoneDigits);
}

export async function isStaffAssistantInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  return (await resolveStaffAssistantInbound(phoneDigits, supabase)) !== null;
}

export function resolveAssistantTier(profile: ExecutiveProfile): AssistantTier {
  if (profile.assistantTier) return profile.assistantTier;
  if (profile.phoneDigits === ARCHITECT_PHONE_DIGITS) return "architect";
  if (profile.phoneDigits === FRONT_DESK_PHONE_DIGITS) return "front_desk";
  return "executive";
}

/** Bare-digit phones for every hardcoded known executive (Eliad + Mike today). */
export function listKnownExecutivePhoneDigits(): string[] {
  return Object.keys(KNOWN_EXECUTIVES);
}

/** profiles.email (lowercase) → the KNOWN_EXECUTIVES profile it falls back to. */
const PROFILE_FALLBACK_EMAILS: Record<string, ExecutiveProfile> = {
  "eliad.benshimol@gmail.com": KNOWN_EXECUTIVES["972505421751"],
  "promote7il@gmail.com": KNOWN_EXECUTIVES["972506842439"],
};

let _profileFallbackCache: { rows: Array<{ email: string; phone: string | null }>; at: number } | null = null;
const PROFILE_FALLBACK_TTL_MS = 5 * 60 * 1000;

async function fetchExecutiveProfilePhones(
  supabase: SupabaseClient,
): Promise<Array<{ email: string; phone: string | null }>> {
  const now = Date.now();
  if (_profileFallbackCache && now - _profileFallbackCache.at < PROFILE_FALLBACK_TTL_MS) {
    return _profileFallbackCache.rows;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("email, phone")
    .in("email", Object.keys(PROFILE_FALLBACK_EMAILS));
  if (error) {
    console.warn("[executiveIdentity] profile fallback lookup failed:", error.message);
    return _profileFallbackCache?.rows ?? [];
  }
  const rows = (data ?? []) as Array<{ email: string; phone: string | null }>;
  _profileFallbackCache = { rows, at: now };
  return rows;
}

function _phoneMatchesInbound(phone: string | null, inbound: string): boolean {
  if (!phone) return false;
  const local = inbound.startsWith("972") ? "0" + inbound.slice(3) : inbound;
  return [inbound, "+" + inbound, local].includes(phone);
}

/**
 * Resolves an inbound phone (any format) to the authorized executive profile.
 * Order: normalize → KNOWN_EXECUTIVES → EXECUTIVE_PHONES/EXECUTIVE_PHONE env
 * → profiles.email/phone fallback. Returns null when nobody matches.
 */
export async function resolveExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<ExecutiveProfile | null> {
  const inbound = normalizeExecutivePhoneDigits(phoneDigits);
  if (!inbound) return null;

  const known = KNOWN_EXECUTIVES[inbound];
  if (known) return known;

  const envPhones = [
    ...(Deno.env.get("EXECUTIVE_PHONES")?.split(",") ?? []),
    Deno.env.get("EXECUTIVE_PHONE") ?? "",
  ]
    .map((p) => p.trim())
    .filter(Boolean);
  for (const envPhone of envPhones) {
    if (normalizeExecutivePhoneDigits(envPhone) === inbound) {
      return { phoneDigits: inbound, displayName: "מנהל", title: "", focus: GENERIC_FOCUS };
    }
  }

  if (!supabase) return null;

  const rows = await fetchExecutiveProfilePhones(supabase);
  for (const row of rows) {
    if (_phoneMatchesInbound(row.phone, inbound)) {
      return PROFILE_FALLBACK_EMAILS[row.email?.toLowerCase()] ?? { phoneDigits: inbound, displayName: "מנהל", title: "", focus: GENERIC_FOCUS };
    }
  }
  return null;
}

/** True when phoneDigits (bare digits, no "+") belongs to an authorized executive. */
export async function isExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  return (await resolveExecutiveInbound(phoneDigits, supabase)) !== null;
}
