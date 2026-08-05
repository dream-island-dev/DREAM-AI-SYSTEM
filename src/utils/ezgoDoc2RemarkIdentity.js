// Mirror of supabase/functions/_shared/ezgoDoc2RemarkIdentity.ts (frontend subset).

import { extractPhonesFromText } from "./ezgoParser";

/** Extra phones in remark → guest_notes; coordinator line when occupant differs. */
export function buildDoc2RemarkGuestNotes(
  remark,
  coordName,
  coordPhone,
  resolvedName,
  resolvedPhone,
) {
  const lines = [];
  const remarkPhones = extractPhonesFromText(remark || "");
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
