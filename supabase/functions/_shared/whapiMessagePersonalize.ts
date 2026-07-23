// supabase/functions/_shared/whapiMessagePersonalize.ts
//
// Anti-spam-fingerprint helper (Layer 3 of the Whapi velocity guard) —
// a burst of byte-identical message bodies to many recipients is itself part
// of WhatsApp's automated-bulk detection signature (2026-07-23 incident:
// identical body to ~40 waiters). {{שם}}/{{name}} substitution already makes
// most guest/staff sends unique; this adds a short trailing reference for
// bulk/cold sends whose body would otherwise be 100% identical (e.g. an
// unnamed contact, or a template with no name placeholder at all).

const NAME_PLACEHOLDER_RE = /\{\{\s*(שם|name)\s*\}\}/gi;
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

export function hasWhapiNamePlaceholder(template: string): boolean {
  NAME_PLACEHOLDER_RE.lastIndex = 0;
  return NAME_PLACEHOLDER_RE.test(String(template ?? ""));
}

export function generateWhapiShortRef(): string {
  let ref = "";
  for (let i = 0; i < 4; i++) {
    ref += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  }
  return ref;
}

/** Replace {{שם}}/{{name}} — unnamed contacts get the greeting minus the token, not a blank. */
export function substituteWhapiName(template: string, name: string | null | undefined): string {
  const trimmedName = String(name ?? "").trim();
  if (trimmedName) {
    return String(template ?? "").replace(NAME_PLACEHOLDER_RE, trimmedName).trim();
  }
  return String(template ?? "")
    .replace(/היי\s*\{\{\s*(שם|name)\s*\}\}\s*!?\s*/gi, "היי! ")
    .replace(NAME_PLACEHOLDER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function appendWhapiUniqueRef(body: string, ref: string = generateWhapiShortRef()): string {
  const trimmed = String(body ?? "").trim();
  return `${trimmed}\n· #${ref}`;
}

export type PersonalizeWhapiBodyOpts = {
  name?: string | null;
  /** Bulk/cold sends only — appends a short trailing ref so body_hash differs per recipient. */
  appendUniqueRef?: boolean;
  uniqueRef?: string;
};

export function personalizeWhapiBody(template: string, opts: PersonalizeWhapiBodyOpts = {}): string {
  const named = substituteWhapiName(template, opts.name);
  if (!opts.appendUniqueRef) return named;
  return appendWhapiUniqueRef(named, opts.uniqueRef);
}
