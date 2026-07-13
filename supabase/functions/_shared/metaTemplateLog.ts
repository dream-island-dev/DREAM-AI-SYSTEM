/**
 * Inbox WYSIWYG helpers — reconstruct Meta template body text for
 * whatsapp_conversations logging (never sent to Meta).
 *
 * Resolution order:
 *   1. message_templates.content (DB, keyed by wa_template_name)
 *   2. TEMPLATE_BODY_APPROVED (static snapshots below)
 *   3. Meta Graph API (cached per template name for the function lifetime)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Substitute Meta positional vars {{1}}, {{2}}, … */
export function substituteMetaTemplateVars(body: string, vars: string[]): string {
  let out = body;
  vars.forEach((v, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), v || "-");
  });
  return out;
}

const NIGHT_BEFORE_SUITES_BASE =
  "מצפים להגעה שלכם לדרים איילנד.\n" +
  "מעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\n" +
  "תגיעו לשער ותצלצלו בפעמון יפתחו לכם.\n" +
  "ממליצים להגיע מוכנים עם בגדי ים וכפכפים.\n";

/** Static snapshots — must match Meta-approved BODY text (logging only). */
export const TEMPLATE_BODY_APPROVED: Record<string, string> = {
  dream_arrival_confirmation:
    "היי {{1}}! כבר ממש סופרים את הימים... 🥳\n" +
    "רק רצינו לוודא שהכל כרגיל לקראת השהות שלכם אצלנו בריזורט בעוד יומיים. " +
    "נשמח אם תאשרו לנו את הגעתכם כאן למטה:",
  dream_checkin_reminder_v2:
    "היי מה שלומכם?🌸\n" +
    NIGHT_BEFORE_SUITES_BASE +
    "כניסה למתחם החל מהשעה - {{1}}\n" +
    "וקבלת החדרים החל משעה - {{2}}\n" +
    "מחכים לכם\n" +
    "צוות דרים איילנד🌸",
  night_before_suites:
    "היי {{1}} מה שלומכם?🌸\n" +
    NIGHT_BEFORE_SUITES_BASE +
    "כניסה למתחם החל מהשעה - 12:00\n" +
    "וקבלת החדרים החל משעה - 15:00\n" +
    "מחכים לכם\n" +
    "צוות דרים איילנד🌸",
  night_before_suites_shabbat:
    "היי {{1}} מה שלומכם?🌸\n" +
    NIGHT_BEFORE_SUITES_BASE +
    "כניסה למתחם החל מהשעה - 15:00\n" +
    "וקבלת החדרים החל משעה - 18:00\n" +
    "מחכים לכם\n" +
    "צוות דרים איילנד🌸",
  dream_suite_reminder:
    "היי {{1}} מה שלומכם?🌸\n" +
    NIGHT_BEFORE_SUITES_BASE +
    "כניסה למתחם החל מהשעה - {{2}}\n" +
    "וקבלת החדרים החל משעה - {{3}}\n" +
    "מחכים לכם\n" +
    "צוות דרים איילנד🌸",
  suite_welcome_morning:
    "בוקר אור {{1}}! ✨ היום זה היום!\n" +
    "הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\n" +
    "כמה פרטים קטנים וחשובים לדרך:\n" +
    "🌸 מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00 בבוקר.\n" +
    "🔑 קבלת החדרים והסוויטות היא החל מהשעה 15:00.\n\n" +
    "אם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️",
  suite_welcome_morning_shabbat:
    "בוקר אור {{1}}! ✨ היום זה היום!\n" +
    "הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\n" +
    "כמה פרטים קטנים וחשובים לדרך:\n" +
    "🌸 כניסה למתחם החל מהשעה 12:00.\n" +
    "🔑 קבלת החדרים והסוויטות היא החל מהשעה 18:00.\n\n" +
    "אם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️",
  dream_mid_stay_check:
    "היי {{1}}, הזמן עף כשנהנים... 🤍\n" +
    "רק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\n" +
    "אם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — " +
    "פשוט תכתבו לנו כאן תגובה חופשית, או לחצו על הכפתור למטה ונציג יצור איתכם קשר מיד. תמשיכו ליהנות! ✨",
  dream_checkout_feedback:
    "היי {{1}}, השערים של הריזורט נסגרו מאחוריכם, ורצינו להגיד תודה ענקית שהתארחתם אצלנו. 🙏 " +
    "החיוך והחוויה שלכם הם הכל עבורנו.\n" +
    "נשמח מאוד לשמוע בכנות — איך היתה השהות שלכם אצלנו?",
  dream_payment_and_workshops:
    "היי {{1}}! איזה כיף, אנחנו כבר מחכים לכם! 🥰\n" +
    "כדי שהצ'ק-אין שלכם בריזורט יהיה מהיר, חלק וללא המתנה מיותרת בדלפק הקבלה, " +
    "נשמח אם תסדירו את יתרת השהות על סך {{2}} ₪ בקישור המאובטח שלכם.\n\n" +
    "בנוסף, מקומות היין והסדנאות הייחודיות שלנו בריזורט כבר כמעט מלאים! " +
    "שווה לשריין מקום מראש בקישור המצורף. נתראה ממש בקרוב! 🥂",
  dream_room_ready:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך! " +
    "אפשר לגשת לדלפק הקבלה לקבלת המפתח ולהתחיל את החוויה. מצפים לראותכם 🌴",
  dream_room_ready1:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה שלך מוכנה ומחכה לך! " +
    "אפשר לגשת לדלפק הקבלה לקבלת המפתח ולהתחיל את החוויה. מצפים לראותכם 🌴",
  dream_handover_agent_v2:
    "תודה על פנייתך, {{1}}. העברנו את בקשתך לאחד מהצוות שיחזור אליך בהקדם. " +
    "דרים איילנד — תמיד לשירותך",
  dream_survey_invite:
    "היי{{1}}, תודה שביליתם איתנו היום! 🌴\n\n" +
    "נשמח שתדרגו את החוויה שלכם במתחם 🙏🏽",
  dream_spa_warmup:
    "היי {{1}}, עוד קצת ומתחיל הטיפול המפנק שלכם בספא ({{2}}) 💆✨\n\n" +
    "זה הזמן להירגע, לנשום עמוק ולהתחיל לעבור למצב פינוק. ניפגש בקרוב!",
  dream_daypass_eve:
    "היי {{1}}, מחר מחכה לכם יום מדהים בדרים איילנד! ☀️\n\n" +
    "כל הצוות כבר מתארגן לקראתכם.\nרק לוודא שאתם איתנו — לחצו על הכפתור ונשמח לקבל אישור 🤍",
};

/** Quick Reply labels — inbox footer only. */
export const TEMPLATE_QUICK_REPLY_BUTTONS: Record<string, string[]> = {
  dream_arrival_confirmation: ["כן, מגיעים! ✨", "לא, שינוי בתאריך 🗓️"],
  dream_mid_stay_check: ["ספא וטיפולים 📜", "דברו איתי 📞"],
  dream_checkout_feedback: ["היה מושלם! ✨", "יש מקום לשיפור 💬"],
  dream_daypass_eve: ["מחכים לכם!"],
};

type MetaComponent = { type?: string; text?: string; buttons?: Array<{ type?: string; text?: string }> };

const _metaBodyCache = new Map<string, string>();
const _metaButtonsCache = new Map<string, string[]>();

async function fetchMetaTemplateComponents(templateName: string): Promise<MetaComponent[] | null> {
  const token = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
  const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID")
    ?? Deno.env.get("META_PHONE_NUMBER_ID")
    ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !wabaId) return null;

  const url =
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
    `?name=${encodeURIComponent(templateName)}` +
    `&fields=name,components&limit=5`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`[metaTemplateLog] Meta API ${res.status} for template ${templateName}`);
      return null;
    }
    const json = await res.json() as { data?: Array<{ name?: string; components?: MetaComponent[] }> };
    const row = (json.data ?? []).find((t) => t.name === templateName) ?? json.data?.[0];
    return row?.components ?? null;
  } catch (e) {
    console.warn(`[metaTemplateLog] Meta fetch failed for ${templateName}:`, (e as Error).message);
    return null;
  }
}

async function fetchMetaTemplateBodyFromApi(templateName: string): Promise<string | null> {
  if (_metaBodyCache.has(templateName)) return _metaBodyCache.get(templateName)!;

  const components = await fetchMetaTemplateComponents(templateName);
  const body = components?.find((c) => c.type === "BODY")?.text?.trim() ?? "";
  if (!body) return null;

  _metaBodyCache.set(templateName, body);

  const buttonsComp = components?.find((c) => c.type === "BUTTONS");
  const qrLabels = (buttonsComp?.buttons ?? [])
    .filter((b) => String(b.type ?? "").toUpperCase() === "QUICK_REPLY")
    .map((b) => String(b.text ?? "").trim())
    .filter(Boolean);
  if (qrLabels.length > 0) {
    _metaButtonsCache.set(templateName, qrLabels);
  }

  return body;
}

export function getTemplateQuickReplyButtons(templateName: string): string[] {
  return _metaButtonsCache.get(templateName)
    ?? TEMPLATE_QUICK_REPLY_BUTTONS[templateName]
    ?? [];
}

export async function resolveMetaTemplateBodyText(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
  vars: string[],
): Promise<string> {
  const { data: mt } = await supabase
    .from("message_templates")
    .select("content")
    .eq("wa_template_name", templateName)
    .maybeSingle();

  let body = mt?.content?.trim() ?? "";
  if (!body && TEMPLATE_BODY_APPROVED[templateName]) {
    body = TEMPLATE_BODY_APPROVED[templateName];
  }
  if (!body) {
    const fromMeta = await fetchMetaTemplateBodyFromApi(templateName);
    if (fromMeta) body = fromMeta;
  }
  if (body) return substituteMetaTemplateVars(body, vars);

  const varsHint = vars.length ? ` (${vars.join(" | ")})` : "";
  return `📋 תבנית Meta: ${templateName}${varsHint}`;
}
