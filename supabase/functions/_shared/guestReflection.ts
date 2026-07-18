// Holistic stay/service reflections — distinct from facility reviews and ops complaints.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REFLECTION_GATE_PATTERN =
  /(ה)?שהות|(ה)?חופשה|(ה)?אירוח|(ה)?חוויה|(ה)?ביקור|(ה)?צוות\s*(היה|היו)|ממליצים|נחזור|(the\s*)?(stay|vacation|experience|visit)/i;

const REFLECTION_QUESTION_EXCLUSION = /^(?:מה|מתי|איך|למה|האם|כמה|איפה)\b/u;

const POSITIVE_REFLECTION_PATTERNS: RegExp[] = [
  /תודה\s*(רבה|ענקית|מהלב)?\s*על\s*(הכל|השהות|האירוח|החוויה|הכנסת\s*האורחים|הכנסת\s*אורחים)/i,
  /(ה)?שהות\s*(שלנו\s*)?(הייתה|היתה)\s*(מדהימה|נהדרת|מושלמת|מעולה|פנטסטית|חלומית|מושקעת)/i,
  /(ה)?(צוות|שירות)\s*(היה|היו)\s*(מדהים|נהדר|מעולה|מקצועי|אדיב|חם|קשוב)/i,
  /ממליצים\s*(בחום|לכולם|מאוד)?/i,
  /חוויה\s*(מדהימה|נהדרת|בלתי\s*נשכחת|מיוחדת)/i,
  /נחזור\s*(בוודאות|בשמחה|בהחלט)|בטוח\s*נחזור/i,
  /best\s*(hotel|stay|vacation|experience)|amazing\s*(stay|experience|service)|highly\s*recommend/i,
];

const NEGATIVE_REFLECTION_PATTERNS: RegExp[] = [
  /(ה)?שהות\s*(שלנו\s*)?(הייתה|היתה)\s*(מאכזבת|גרועה|לא\s*טובה|לא\s*מספקת|לא\s*ברמה)/i,
  /לא\s*(נחזור|נמליץ|נבוא\s*שוב)/i,
  /(ה)?(צוות|שירות)\s*(היה|היו)\s*(גרוע|לא\s*מקצועי|לא\s*אדיב|מזלזל)/i,
  /לא\s*היה\s*שווה\s*(את\s*)?ה(כסף|מחיר)/i,
  /worst\s*(stay|experience|hotel|vacation)|disappointing\s*(stay|experience)|would\s*not\s*recommend/i,
];

export type GuestReflectionSentiment = "positive" | "negative" | "neutral";

export function classifyGuestReflection(text: string): GuestReflectionSentiment | null {
  const t = text.trim();
  if (t.length < 6 || t.endsWith("?") || REFLECTION_QUESTION_EXCLUSION.test(t)) return null;
  if (!REFLECTION_GATE_PATTERN.test(t)) return null;
  if (POSITIVE_REFLECTION_PATTERNS.some((p) => p.test(t))) return "positive";
  if (NEGATIVE_REFLECTION_PATTERNS.some((p) => p.test(t))) return "negative";
  return "neutral";
}

export function buildReflectionReply(sentiment: GuestReflectionSentiment): string {
  if (sentiment === "positive") {
    const reviewUrl = Deno.env.get("GOOGLE_REVIEW_URL") ?? "dream-island.co.il";
    return `איזה כיף לשמוע! 🌟 שמחים מאוד שנהניתם. אם תרצו לשתף את החוויה שלכם עם עוד אורחים — זה יעשה לנו את היום:\n${reviewUrl}\nתודה רבה ומחכים לראותכם שוב! 💫`;
  }
  if (sentiment === "negative") {
    return "תודה שסיפרתם לנו על כך. 🙏 אנחנו מצטערים שהיה חלק מהשהות שלא עמד בציפיות, והדברים חשובים לנו מאוד. הצוות שלנו יבחן את זה כדי שנשתפר.";
  }
  return "תודה רבה ששיתפתם אותנו! 🙏 נשמח תמיד לשמוע עוד על השהות שלכם.";
}

export async function saveGuestReflectionFeedback(
  supabase: ReturnType<typeof createClient>,
  opts: {
    guestId: number | null;
    phone: string;
    sentiment: GuestReflectionSentiment;
    text: string;
    source?: "freeform_reflection" | "severe_complaint";
  },
): Promise<void> {
  const { error } = await supabase.from("guest_feedback").insert({
    guest_id: opts.guestId,
    phone: opts.phone,
    sentiment: opts.sentiment,
    feedback_text: opts.text,
    source: opts.source ?? "freeform_reflection",
  });
  if (error) {
    console.error("[guestReflection] insert FAILED:", error.message);
  }
}
