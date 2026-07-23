// Waiter pulse contact roster — parse/import + message personalization.

import { normalizeWhatsAppPhone } from "./ezgoParser";

export const WAITER_PULSE_SEND_DELAY_MS = 2500;

export const DEFAULT_WAITER_PULSE_INVITE_MESSAGE = `היי {{שם}}! 🙏
אנחנו שמחים שאתם חלק ממשפחת דרים איילנד!

אנחנו תמיד רוצים להשתפר, ונשמח שתביעו את דעתכם בסקר האנונימי:
{{קישור}}

תודה רבה! 💛`;

const PHONE_IN_LINE_RE = /(\+?\d[\d\s\-().]{7,}\d)/;

/**
 * Parse pasted lines: "Name: +972…", "Name +972…", or bare phone per line.
 * @returns {{ rows: Array<{name: string, phone: string}>, invalid: string[] }}
 */
export function parseWaiterPulsePaste(text) {
  const rows = [];
  const invalid = [];
  const seen = new Set();

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const phoneMatch = line.match(PHONE_IN_LINE_RE);
    if (!phoneMatch) {
      invalid.push(line);
      continue;
    }

    const phone = normalizeWhatsAppPhone(phoneMatch[1]);
    if (!phone) {
      invalid.push(line);
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);

    let name = line.slice(0, phoneMatch.index).trim();
    name = name.replace(/^[:：\-–—|]+\s*/, "").replace(/\s*[:：\-–—|]+\s*$/, "").trim();
    rows.push({ name, phone });
  }

  return { rows, invalid };
}

/** Replace {{שם}} / {{קישור}} — unnamed contacts get greeting without a name token. */
export function personalizeWaiterPulseInvite(template, { name, link }) {
  const safeLink = String(link ?? "").trim();
  let msg = String(template ?? "").replace(/\{\{קישור\}\}/g, safeLink);

  const trimmedName = String(name ?? "").trim();
  if (trimmedName) {
    return msg.replace(/\{\{שם\}\}/g, trimmedName).trim();
  }

  msg = msg
    .replace(/היי\s*\{\{שם\}\}\s*!?\s*/g, "היי! ")
    .replace(/\{\{שם\}\}/g, "");
  return msg.replace(/\n{3,}/g, "\n\n").trim();
}
