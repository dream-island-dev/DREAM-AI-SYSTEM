/**
 * Pure helpers mirrored from supabase/functions/_shared/automationSchedule.ts
 * for npm test coverage. Keep in sync when editing the Deno source.
 */

export const COURTESY_ONLY_PATTERN =
  /^(?:תודה(?:\s*רבה)?|תודה\s*לך|הבנתי|הבנת|סגור|סבבה|בסדר(?:\s*גמור)?|אוקיי?|יא?ל+ה|מעולה|נהדר|great|awesome|perfect|cool|thanks?(?:\s*a\s*lot)?|thank\s*you|thx|ty|ok(?:ay)?|got\s*it|understood|sounds?\s*good)[\s!.,?~*'"]*[\p{Extended_Pictographic}☀-➿]*[\s!.,?~*'"]*$/iu;

const GREETING_TOKEN =
  "(?:היי+|הי|שלום|hey|hi|hello|good\\s*(?:morning|evening|afternoon))";
export const GREETING_ONLY_PATTERN = new RegExp(
  `^${GREETING_TOKEN}(?:\\s+${GREETING_TOKEN})*[\\s!.,?~*'\"]*[\\p{Extended_Pictographic}☀-➿]*[\\s!.,?~*'\"]*$`,
  "iu",
);

export function isGuestGreetingMessage(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return GREETING_ONLY_PATTERN.test(t);
}

export function isLowValueCourtesyMessage(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isGuestGreetingMessage(t)) return false;
  if (/^[\s\p{Extended_Pictographic}‍️☀-➿]+$/u.test(t)) return true;
  return COURTESY_ONLY_PATTERN.test(t);
}
