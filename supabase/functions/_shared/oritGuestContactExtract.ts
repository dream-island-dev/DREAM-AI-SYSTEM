// Extract guest contact details from Dream Island website form emails (Orit CS Agent).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OritGuestContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/;

const NOREPLY_RE = /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)@/i;
const INTERNAL_DOMAIN_RE = /@dream-island\.co\.il$/i;
const RELAY_DOMAIN_RE = /@(?:richkid\.co\.il|forms\.gle|wixpress\.com)$/i;

export function isRelayOrSystemEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  if (NOREPLY_RE.test(e)) return true;
  if (INTERNAL_DOMAIN_RE.test(e)) return true;
  if (RELAY_DOMAIN_RE.test(e)) return true;
  return false;
}

function findGuestEmailInText(text: string, exclude: Set<string>): string | null {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const m of text.matchAll(re)) {
    const email = m[0].toLowerCase();
    if (exclude.has(email)) continue;
    if (isRelayOrSystemEmail(email)) continue;
    return email;
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'");
}

function normalizeILPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!/^05\d{8}$/.test(digits)) return null;
  return `+972${digits.slice(1)}`;
}

export function extractGuestContactFromFormBody(bodyText: string): OritGuestContact {
  const text = decodeHtmlEntities(String(bodyText ?? "")).replace(/\s+/g, " ").trim();
  if (!text) return { name: null, email: null, phone: null };

  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

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
    email = findGuestEmailInText(text, new Set());
  }

  if (!phone) {
    const ilMatch = text.match(IL_MOBILE_RE);
    if (ilMatch?.[1]) phone = normalizeILPhone(ilMatch[1]);
  }

  return { name, email, phone };
}

export function resolveOritReplyEmail(
  fromEmail: string,
  guestContactEmail: string | null | undefined,
): string {
  const guest = (guestContactEmail || "").trim().toLowerCase();
  if (guest && guest.includes("@") && !isRelayOrSystemEmail(guest)) return guest;
  const from = (fromEmail || "").trim().toLowerCase();
  if (from && !isRelayOrSystemEmail(from)) return from;
  return "";
}

export function resolveOritReplyName(
  fromName: string | null | undefined,
  guestContactName: string | null | undefined,
): string | null {
  const guest = (guestContactName || "").trim();
  if (guest && !guest.includes("@")) return guest;
  const from = (fromName || "").trim();
  if (from && !from.includes("@")) return from;
  return guest || from || null;
}

export function buildGuestContactPatch(contact: OritGuestContact): Record<string, string> {
  const patch: Record<string, string> = {};
  if (contact.email) patch.guest_contact_email = contact.email;
  if (contact.phone) patch.guest_contact_phone = contact.phone;
  if (contact.name) patch.guest_contact_name = contact.name;
  return patch;
}

export async function enrichOritThreadGuestContact(
  supabase: SupabaseClient,
  threadId: string,
  bodyText?: string,
): Promise<OritGuestContact | null> {
  let combined = (bodyText || "").trim();

  if (!combined) {
    const { data: msgs } = await supabase
      .from("orit_agent_messages")
      .select("body_text")
      .eq("thread_id", threadId)
      .eq("direction", "inbound")
      .order("received_at", { ascending: true })
      .limit(3);
    combined = (msgs ?? []).map((m) => m.body_text).join("\n").trim();
  }

  if (!combined) return null;

  const contact = extractGuestContactFromFormBody(combined);
  const patch = buildGuestContactPatch(contact);
  if (!Object.keys(patch).length) return null;

  await supabase.from("orit_agent_threads").update(patch).eq("id", threadId);
  return contact;
}

export async function backfillOritGuestContacts(
  supabase: SupabaseClient,
  mailboxId: string,
  limit = 80,
): Promise<number> {
  const { data: threads } = await supabase
    .from("orit_agent_threads")
    .select("id")
    .eq("mailbox_id", mailboxId)
    .eq("is_demo", false)
    .is("guest_contact_email", null)
    .order("received_at", { ascending: false })
    .limit(limit);

  let updated = 0;
  for (const row of threads ?? []) {
    const result = await enrichOritThreadGuestContact(supabase, row.id);
    if (result?.email || result?.phone || result?.name) updated += 1;
  }
  return updated;
}
