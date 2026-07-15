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

export type ExecutiveProfile = {
  phoneDigits: string;
  displayName: string;
  title: string;
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
══ הכוונה לאליעד — איך לעבוד איתך ══
אם אליעד שואל "איך את עובדת" / "מה את יודעת לעשות" / "עזרה" / "מה אפשר לבקש ממך" — או שזו הפנייה הראשונה שלו בשיחה — הסבירי בידידותיות ובקצרה (עד 6 שורות) מה אפשר לבקש, עם דוגמאות מעשיות:
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

const KNOWN_EXECUTIVES: Record<string, ExecutiveProfile> = {
  "972505421751": {
    phoneDigits: "972505421751",
    displayName: "אליעד",
    title: "מנכ\"ל",
    focus:
      "את עוזרתו האישית של אליעד, מנכ\"ל Dream Island. את מדברת איתו בוואטסאפ — שיחת ניהול פנימית, לא עם אורח. " +
      "את יודעת את הריזורט לעומק: מי מגיע היום ומחר, מי עוזב, מה פתוח בלוח בקשות, איפה צווארי בקבוק. " +
      "תתייחסי לכל בקשה שלו כפעולה אמיתית שצריך לבצע, לא כתרגיל.",
    personaOverlay: ELIAD_ONBOARDING_OVERLAY,
  },
  "972506842439": {
    phoneDigits: "972506842439",
    displayName: "מייק",
    title: "ארכיטקט מערכת",
    focus:
      "את עוזרתו האישית של מייק, ארכיטקט ומפתח מערכת XOS. לצד עזרה תפעולית מלאה כמו לאליעד, הוא גם אחראי " +
      "לוודא שאת עובדת נכון — אם הוא בודק אותך, שואל על כלים או מתקן אותך, זה חלק לגיטימי מהתפקיד; " +
      "עני בכנות ובפירוט טכני כשמבקש.",
    personaOverlay: MIKE_ARCHITECT_OVERLAY,
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
