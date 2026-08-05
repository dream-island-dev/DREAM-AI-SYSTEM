// Shared Doc2 remark occupant identity — group/municipal bookings where the same
// coordinator name appears on 2+ rows and the real guest lives in sRemark / הערות.

import {
  extractPhoneFromOpsText,
  sanitizeE164,
} from "./ezgoDoc1Parser.ts";

const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/g;
const IL_MOBILE_FIRST_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/;
const MEAL_TIME_REMARK_RE = /א\.?\s*ערב\s*(\d{1,2}:\d{2})/;

export function extractPhonesFromRemarkText(text: string): string[] {
  const out: string[] = [];
  const s = String(text || "");
  for (const m of s.matchAll(IL_MOBILE_RE)) {
    const e164 = sanitizeE164(extractPhoneFromOpsText(m[1]) || m[1]);
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out;
}

/**
 * Dual/multi-occupant remarks ("אורטל בנטורה 050-3302020 / דני כהן 052-1234567")
 * used to break this: stripping every phone match from the whole string first
 * left both names glued together into one garbled blob, which then got paired
 * with remarkPhones[0] — occupant #1's phone next to a #1+#2 mashed name (Mike,
 * P0 2026-08-05). Take everything BEFORE the first phone instead (same strategy
 * as ezgoParser.js's extractNameFromRemark, proven there for the CSV path) —
 * that's occupant #1's name segment, correctly paired with remarkPhones[0].
 */
const REMARK_NAME_NOISE_RES = [
  /","/,
  /,\s*,/,
  /₪/,
  /\s+\d+\s*בחדר/,
  /\s+בחדר\b/,
  /\s+תוספת\b/,
  /\s+פרטי\b/,
  /\s+\d+\s*שח/,
  /\s+תשלום\b/,
  /\s+ביום\b/,
];

function trimRemarkNameNoise(text: string): string {
  let s = String(text ?? "").trim();
  if (!s) return "";
  for (const re of REMARK_NAME_NOISE_RES) {
    const m = re.exec(s);
    if (m && m.index > 0) s = s.slice(0, m.index).trim();
  }
  s = s.replace(/[\s\-+/|,;"]+$/, "").trim();
  const digitCut = s.match(/^(.+?)\s+\d/);
  if (digitCut) s = digitCut[1].trim();
  return s;
}

function pickOccupantNameFromPrefix(namePart: string): string {
  const segments = String(namePart ?? "")
    .split(/\s*[/+]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  const raw = segments.length > 1 ? segments[segments.length - 1] : String(namePart ?? "");
  return trimRemarkNameNoise(raw);
}

function remarkHasEmbeddedPhone(text: string): boolean {
  return IL_MOBILE_FIRST_RE.test(String(text ?? ""));
}

/** Remark holds occupant name only — phone lives in the לקוח column. */
export function extractNameFromRemarkWithoutPhone(remark: string): string | null {
  const s = String(remark ?? "").trim();
  if (!s || remarkHasEmbeddedPhone(s)) return null;
  const cleaned = pickOccupantNameFromPrefix(s);
  if (!cleaned || cleaned.length < 2) return null;
  if (!/^[\u0590-\u05FFa-zA-Z\s'"/+-]+$/.test(cleaned)) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;
  return cleaned;
}

/** Extra phones in remark → guest_notes; coordinator line when occupant differs. */
export function buildDoc2RemarkGuestNotes(
  remark: string | null,
  coordName: string | null,
  coordPhone: string | null,
  resolvedName: string | null,
  resolvedPhone: string | null,
): string | null {
  const lines: string[] = [];
  const remarkPhones = extractPhonesFromRemarkText(remark || "");
  const primary = resolvedPhone || remarkPhones[0] || null;
  const extras = remarkPhones.filter((p) => p && p !== primary);
  if (extras.length) {
    lines.push(`טלפון נוסף מהערות: ${extras.join(", ")}`);
  }
  const coord = String(coordName ?? "").trim();
  const guest = String(resolvedName ?? "").trim();
  if (coord && guest && coord !== guest) {
    lines.push(`רכז/ה הזמנה: ${coord}${coordPhone ? ` (${coordPhone})` : ""}`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function extractNameFromRemarkText(remark: string): string | null {
  const s = String(remark || "").trim();
  if (!s) return null;
  const firstPhone = IL_MOBILE_FIRST_RE.exec(s);
  if (!firstPhone) return null;

  let name = s.slice(0, firstPhone.index);
  name = name.replace(/\s*-\s*א\.?\s*ערב\s*\d{1,2}:\d{2}/g, "");
  name = name.replace(MEAL_TIME_REMARK_RE, "");
  name = name.replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\s*-\s*-\s*/g, " - ").replace(/\s*-\s*$/, "").trim();

  const dashParts = name.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  if (dashParts.length > 1) {
    const first = dashParts[0];
    const rest = dashParts.slice(1).join(" ");
    const restIsOps = /א\.?\s*ערב|חוגג|יום הולדת|בקשה|מיטה|פנק/i.test(rest);
    if (first.length >= 2 && restIsOps) name = first;
  }

  return name || null;
}

/** EZGO remark meal-time shorthand — "א. ערב 19:30" → "19:30". Mirrors
 * ezgoParser.js's extractMealTimeFromRemark for the CSV path. */
export function extractMealTimeFromRemarkText(remark: string): string | null {
  const m = String(remark || "").match(MEAL_TIME_REMARK_RE);
  return m ? m[1] : null;
}

function isDummyPhone(phone: string | null): boolean {
  if (!phone) return true;
  const digits = phone.replace(/\D/g, "");
  return digits.length < 9 || /^0{9,}$/.test(digits);
}

export type Doc2ClientIdentity = {
  guest_name: string | null;
  phone: string | null;
};

/**
 * When coordNameDuplicated=true, occupant name+phone come from remark (הערות).
 * Mirrors ezgoDoc2SuiteCsvParser.extractSuiteRow + ezgoParser.js extractGuestDetails.
 */
export function resolveDoc2GuestIdentity(
  coordName: string | null,
  coordPhone: string | null,
  remark: string | null,
  coordNameDuplicated: boolean,
): Doc2ClientIdentity {
  if (!coordNameDuplicated) {
    return { guest_name: coordName, phone: coordPhone };
  }

  const remarkPhones = extractPhonesFromRemarkText(remark || "");
  const remarkName = extractNameFromRemarkText(remark || "")
    ?? extractNameFromRemarkWithoutPhone(remark || "");

  if (remarkPhones.length > 0 && remarkName) {
    return { guest_name: remarkName, phone: remarkPhones[0] };
  }
  if (remarkPhones.length > 0) {
    return { guest_name: remarkName || coordName, phone: remarkPhones[0] };
  }
  if (remarkName && coordPhone && !isDummyPhone(coordPhone)) {
    return { guest_name: remarkName, phone: coordPhone };
  }
  if (coordPhone && !isDummyPhone(coordPhone)) {
    return { guest_name: remarkName || coordName, phone: coordPhone };
  }
  return { guest_name: remarkName || coordName, phone: coordPhone };
}

export function duplicateCoordNameKeys(
  names: Array<string | null | undefined>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [name, n] of counts) {
    if (n > 1) dupes.add(name);
  }
  return dupes;
}
