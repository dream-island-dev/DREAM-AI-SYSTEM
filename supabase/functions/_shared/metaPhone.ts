// Meta Cloud API `to` field — digits only, Israeli mobiles → 972XXXXXXXXX.
// Meta returns HTTP 200 for malformed recipients but delivery silently fails.

export function sanitizeMetaRecipientPhone(phone: unknown): string {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) throw new Error("invalid_meta_recipient_phone: empty");

  if (digits.startsWith("00972")) digits = digits.slice(2);

  if (digits.startsWith("972")) return digits;

  if (digits.startsWith("05")) return "972" + digits.slice(1);

  if (digits.startsWith("0")) return "972" + digits.slice(1);

  if (digits.length === 9 && digits.startsWith("5")) return "972" + digits;

  return digits;
}
