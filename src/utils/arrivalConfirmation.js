/**
 * Pure JS mirror of supabase/functions/_shared/arrivalConfirmation.ts
 * for unit tests (CRA cannot import Deno edge modules).
 * Keep in sync when matcher logic changes.
 */

export function normalizeInboundConfirmText(raw) {
  return String(raw ?? "")
    .replace(/\*+/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function hebrewOnlyLetters(s) {
  return s.replace(/[^א-ת]/g, "");
}

const CONFIRMATION_RE =
  /^[\s🎉✨😊🙂🙏💫🌴]*(?:כן[,!\s.]*)?(?:מגיעים|אנחנו מגיעים|כן מגיעים|כן,מגיעים|כן! מגיעים|כן|אישור|yes|מאשר|מאשרת|כן תודה|כן אישור|אישורי)[\s🎉✨😊🙂🙏💫🌴!.,✨]*$/iu;

function isExplicitArrivalDecline(raw) {
  const t = normalizeInboundConfirmText(raw);
  if (!t) return false;
  if (t.includes("שינוי בתאריך")) return true;
  const heb = hebrewOnlyLetters(t);
  if (heb.startsWith("לא") && !heb.includes("כן")) return true;
  return false;
}

export function isArrivalConfirmationMessage(raw, opts = {}) {
  const text = normalizeInboundConfirmText(raw);
  if (text && isExplicitArrivalDecline(text)) return false;

  if (text && CONFIRMATION_RE.test(text)) return true;

  const titleHeb = hebrewOnlyLetters(opts.buttonTitle ?? text);
  const idHeb = hebrewOnlyLetters(opts.buttonId ?? "");
  if (
    titleHeb &&
    ((titleHeb.includes("כן") && titleHeb.includes("מגיעים")) ||
      titleHeb === "כןמגיעים" ||
      titleHeb === "מגיעים")
  ) {
    return true;
  }
  if (
    idHeb.includes("כןמגיעים") ||
    (opts.buttonId ?? "").toLowerCase().includes("confirm") ||
    (opts.buttonId ?? "").toLowerCase().includes("arriving") ||
    (opts.buttonId ?? "").toLowerCase().includes("yes_arrive")
  ) {
    return true;
  }
  if (text) {
    const heb = hebrewOnlyLetters(text);
    if (
      (heb.includes("כן") && heb.includes("מגיעים")) ||
      heb === "כןמגיעים" ||
      heb === "מגיעים"
    ) {
      return true;
    }
  }
  return false;
}
