// supabase/functions/_shared/guestProfile.ts
// Deno mirror of src/data/guestProfileSchema.js tag IDs + AI formatter.

const VIP_LABELS: Record<string, string> = {
  vip: "VIP",
  vvip: "VVIP",
};

const OCCASION_LABELS: Record<string, string> = {
  birthday: "יום הולדת",
  anniversary: "יום נישואין",
  honeymoon: "ירח דבש",
  celebration: "חגיגה",
  other: "אירוע מיוחד",
};

const DIETARY_LABELS: Record<string, string> = {
  vegetarian: "צמחוני",
  vegan: "טבעוני",
  gluten_free: "ללא גלוטן",
  kosher_strict: "כשר מהדרין",
  halal: "חלאל",
  allergy_nuts: "אלרגיה לאגוזים",
  allergy_seafood: "אלרגיה לפירות ים",
  lactose_free: "ללא לקטוז",
};

const ARRIVAL_LABELS: Record<string, string> = {
  late_arrival: "הגעה מאוחרת",
  early_checkin: "צ׳ק-אין מוקדם",
  accessibility: "נגישות",
  with_children: "עם ילדים",
  first_time: "ביקור ראשון",
  shuttle_needed: "נדרש הסעה",
};

export function formatGuestProfileForAi(
  profile: Record<string, unknown> | null | undefined,
  arrivalTime?: string | null,
): string {
  if (!profile || typeof profile !== "object") {
    return arrivalTime ? `פרופיל אורח: שעת הגעה משוערת: ${arrivalTime}` : "";
  }

  const parts: string[] = [];

  const vip = profile.vip_status as string | undefined;
  if (vip && VIP_LABELS[vip]) parts.push(VIP_LABELS[vip]);

  const occ = profile.occasion as Record<string, unknown> | undefined;
  if (occ && typeof occ === "object") {
    const type = occ.type as string | undefined;
    if (type && type !== "none" && OCCASION_LABELS[type]) {
      let line = `אירוע: ${OCCASION_LABELS[type]}`;
      if (typeof occ.date === "string" && occ.date) line += ` (${occ.date})`;
      if (typeof occ.note === "string" && occ.note.trim()) line += ` — ${occ.note.trim()}`;
      parts.push(line);
    }
  }

  const diet = profile.dietary as Record<string, unknown> | undefined;
  if (diet && typeof diet === "object") {
    const tags = Array.isArray(diet.tags)
      ? (diet.tags as string[]).map((t) => DIETARY_LABELS[t] ?? t).filter(Boolean)
      : [];
    const note = typeof diet.note === "string" ? diet.note.trim() : "";
    if (tags.length || note) {
      parts.push(`תזונה: ${[tags.join(", "), note].filter(Boolean).join(" — ")}`);
    }
  }

  const arr = profile.arrival_context as Record<string, unknown> | undefined;
  if (arr && typeof arr === "object") {
    const tags = Array.isArray(arr.tags)
      ? (arr.tags as string[]).map((t) => ARRIVAL_LABELS[t] ?? t).filter(Boolean)
      : [];
    const note = typeof arr.note === "string" ? arr.note.trim() : "";
    if (tags.length || note) {
      parts.push(`הקשר הגעה: ${[tags.join(", "), note].filter(Boolean).join(" — ")}`);
    }
  }

  const staffNote = typeof profile.staff_note === "string" ? profile.staff_note.trim() : "";
  if (staffNote) parts.push(`הערת צוות: ${staffNote}`);

  if (arrivalTime) parts.push(`שעת הגעה משוערת: ${arrivalTime}`);

  return parts.length ? `פרופיל אורח: ${parts.join(" | ")}` : "";
}
