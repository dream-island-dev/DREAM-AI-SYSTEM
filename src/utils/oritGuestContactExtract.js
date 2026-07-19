/**
 * Mirrors supabase/functions/_shared/oritGuestContactExtract.ts — keep in sync for UI.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/;

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

  const emailMatch = text.match(/דוא["']?ל\s*:\s*([^\s]+@[^\s]+)/i);
  if (emailMatch?.[1]) {
    email = emailMatch[1].replace(/[.,;]+$/, "").trim().toLowerCase();
  }

  if (!email) {
    const generic = text.match(EMAIL_RE);
    if (generic?.[0]) email = generic[0].toLowerCase();
  }

  if (!phone) {
    const ilMatch = text.match(IL_MOBILE_RE);
    if (ilMatch?.[1]) phone = normalizeILPhone(ilMatch[1]);
  }

  return { name, email, phone };
}

export function resolveOritReplyEmail(fromEmail, guestContactEmail) {
  const guest = (guestContactEmail || "").trim().toLowerCase();
  if (guest && guest.includes("@")) return guest;
  return (fromEmail || "").trim();
}

export function resolveOritReplyName(fromName, guestContactName) {
  const guest = (guestContactName || "").trim();
  if (guest) return guest;
  const from = (fromName || "").trim();
  return from || null;
}

export function oritThreadGuestLabel(thread) {
  const name = resolveOritReplyName(thread?.from_name, thread?.guest_contact_name);
  const email = resolveOritReplyEmail(thread?.from_email, thread?.guest_contact_email);
  if (name && email) return `${name} · ${email}`;
  return name || email || thread?.from_email || "אורח";
}
