/**
 * Mirrors supabase/functions/_shared/oritGuestContactExtract.ts — keep in sync for UI.
 */

const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/;

const NOREPLY_RE = /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)@/i;
const INTERNAL_DOMAIN_RE = /@dream-island\.co\.il$/i;
const RELAY_DOMAIN_RE = /@(?:richkid\.co\.il|forms\.gle|wixpress\.com)$/i;

export function isRelayOrSystemEmail(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  if (NOREPLY_RE.test(e)) return true;
  if (INTERNAL_DOMAIN_RE.test(e)) return true;
  if (RELAY_DOMAIN_RE.test(e)) return true;
  return false;
}

function findGuestEmailInText(text, exclude = new Set()) {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const m of text.matchAll(re)) {
    const email = m[0].toLowerCase();
    if (exclude.has(email)) continue;
    if (isRelayOrSystemEmail(email)) continue;
    return email;
  }
  return null;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'");
}

function normalizeILPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!/^05\d{8}$/.test(digits)) return null;
  return `+972${digits.slice(1)}`;
}

export function extractGuestContactFromFormBody(bodyText) {
  const text = decodeHtmlEntities(String(bodyText ?? "")).replace(/\s+/g, " ").trim();
  if (!text) return { name: null, email: null, phone: null };

  let name = null;
  let email = null;
  let phone = null;

  const nameMatch = text.match(/שם\s*מלא\s*:\s*(.+?)(?=\s*טלפון\s*:|$)/i);
  if (nameMatch?.[1]) {
    const cleaned = nameMatch[1].trim();
    if (cleaned.length >= 2) name = cleaned;
  }

  const phoneMatch = text.match(/טלפון\s*:\s*((?:0|\+972)[\d\- ]{8,14})/i);
  if (phoneMatch?.[1]) phone = normalizeILPhone(phoneMatch[1]);

  const emailMatch = text.match(/(?:דוא["']?ל|דואר\s*אלקטרוני|email)\s*:\s*([^\s]+@[^\s]+)/i);
  if (emailMatch?.[1]) {
    const candidate = emailMatch[1].replace(/[.,;]+$/, "").trim().toLowerCase();
    if (!isRelayOrSystemEmail(candidate)) email = candidate;
  }

  if (!email) {
    email = findGuestEmailInText(text);
  }

  if (!phone) {
    const ilMatch = text.match(IL_MOBILE_RE);
    if (ilMatch?.[1]) phone = normalizeILPhone(ilMatch[1]);
  }

  return { name, email, phone };
}

export function resolveOritReplyEmail(fromEmail, guestContactEmail) {
  const guest = (guestContactEmail || "").trim().toLowerCase();
  if (guest && guest.includes("@") && !isRelayOrSystemEmail(guest)) return guest;
  const from = (fromEmail || "").trim().toLowerCase();
  if (from && !isRelayOrSystemEmail(from)) return from;
  return "";
}

export function resolveOritReplyName(fromName, guestContactName) {
  const guest = (guestContactName || "").trim();
  if (guest && !guest.includes("@")) return guest;
  const from = (fromName || "").trim();
  if (from && !from.includes("@")) return from;
  return guest || from || null;
}

export function oritThreadGuestLabel(thread) {
  const name = resolveOritReplyName(thread?.from_name, thread?.guest_contact_name);
  const email = resolveOritReplyEmail(thread?.from_email, thread?.guest_contact_email);
  if (name && email) return `${name} · ${email}`;
  return name || email || thread?.from_email || "אורח";
}
