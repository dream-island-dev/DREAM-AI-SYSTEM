// src/data/guestProfileSchema.js
// Single source of truth for Smart Guest Profile tag IDs + UI labels (frontend).
// Tag IDs are stable English keys — mirrored in supabase/functions/_shared/guestProfile.ts
// for whatsapp-webhook AI context formatting.

export const VIP_STATUSES = [
  { id: "standard", label: "רגיל" },
  { id: "vip",      label: "⭐ VIP" },
];

export const OCCASION_TYPES = [
  { id: "none",         label: "ללא אירוע מיוחד" },
  { id: "birthday",     label: "🎂 יום הולדת" },
  { id: "anniversary",  label: "💍 יום נישואין" },
  { id: "honeymoon",    label: "💑 ירח דבש" },
  { id: "celebration",  label: "🎉 חגיגה" },
  { id: "other",        label: "אחר" },
];

export const DIETARY_TAGS = [
  { id: "vegetarian",      label: "צמחוני" },
  { id: "vegan",           label: "טבעוני" },
  { id: "gluten_free",     label: "ללא גלוטן" },
  { id: "allergy_nuts",    label: "אלרגיה: אגוזים" },
];

export const ARRIVAL_CONTEXT_TAGS = [
  { id: "late_arrival",    label: "הגעה מאוחרת" },
  { id: "early_checkin",   label: "בקשת צ׳ק-אין מוקדם" },
  { id: "accessibility",   label: "נגישות / מוגבלות" },
  { id: "with_children",   label: "עם ילדים" },
  { id: "first_time",      label: "ביקור ראשון" },
];

const VIP_IDS = new Set(VIP_STATUSES.map((x) => x.id));
const OCCASION_IDS = new Set(OCCASION_TYPES.map((x) => x.id));
const DIETARY_IDS = new Set(DIETARY_TAGS.map((x) => x.id));
const ARRIVAL_IDS = new Set(ARRIVAL_CONTEXT_TAGS.map((x) => x.id));

export function emptyGuestProfile() {
  return {
    vip_status: "standard",
    occasion: { type: "none", date: "", note: "" },
    dietary: { tags: [], note: "" },
    arrival_context: { tags: [], note: "" },
    staff_note: "",
  };
}

/** Coerce DB JSONB / partial objects into a safe shape for the form. */
export function normalizeGuestProfile(raw) {
  const base = emptyGuestProfile();
  if (!raw || typeof raw !== "object") return base;

  const vip = raw.vip_status;
  if (VIP_IDS.has(vip)) base.vip_status = vip;

  const occ = raw.occasion;
  if (occ && typeof occ === "object") {
    if (OCCASION_IDS.has(occ.type)) base.occasion.type = occ.type;
    if (typeof occ.date === "string") base.occasion.date = occ.date.slice(0, 10);
    if (typeof occ.note === "string") base.occasion.note = occ.note;
  }

  const diet = raw.dietary;
  if (diet && typeof diet === "object") {
    if (Array.isArray(diet.tags)) {
      base.dietary.tags = diet.tags.filter((t) => DIETARY_IDS.has(t));
    }
    if (typeof diet.note === "string") base.dietary.note = diet.note;
  }

  const arr = raw.arrival_context;
  if (arr && typeof arr === "object") {
    if (Array.isArray(arr.tags)) {
      base.arrival_context.tags = arr.tags.filter((t) => ARRIVAL_IDS.has(t));
    }
    if (typeof arr.note === "string") base.arrival_context.note = arr.note;
  }

  if (typeof raw.staff_note === "string") base.staff_note = raw.staff_note;

  return base;
}

/** Strip empty fields before DB write. */
export function serializeGuestProfile(formProfile) {
  const p = normalizeGuestProfile(formProfile);
  const out = { vip_status: p.vip_status };

  if (p.occasion.type !== "none" || p.occasion.date || p.occasion.note.trim()) {
    out.occasion = {
      type: p.occasion.type,
      ...(p.occasion.date ? { date: p.occasion.date } : {}),
      ...(p.occasion.note.trim() ? { note: p.occasion.note.trim() } : {}),
    };
  }

  if (p.dietary.tags.length > 0 || p.dietary.note.trim()) {
    out.dietary = {
      ...(p.dietary.tags.length ? { tags: p.dietary.tags } : {}),
      ...(p.dietary.note.trim() ? { note: p.dietary.note.trim() } : {}),
    };
  }

  if (p.arrival_context.tags.length > 0 || p.arrival_context.note.trim()) {
    out.arrival_context = {
      ...(p.arrival_context.tags.length ? { tags: p.arrival_context.tags } : {}),
      ...(p.arrival_context.note.trim() ? { note: p.arrival_context.note.trim() } : {}),
    };
  }

  if (p.staff_note.trim()) out.staff_note = p.staff_note.trim();

  return out;
}

export function hasMeaningfulProfile(profile) {
  const p = normalizeGuestProfile(profile);
  return (
    p.vip_status !== "standard"
    || p.occasion.type !== "none"
    || p.dietary.tags.length > 0
    || p.arrival_context.tags.length > 0
    || !!p.staff_note.trim()
    || !!p.dietary.note.trim()
    || !!p.arrival_context.note.trim()
    || !!p.occasion.note.trim()
  );
}

const labelById = (list, id) => list.find((x) => x.id === id)?.label ?? id;

/** Hebrew one-liner for AI system context (frontend preview / debug). */
export function formatGuestProfileForAi(profile, arrivalTime) {
  const p = normalizeGuestProfile(profile);
  const parts = [];

  if (p.vip_status === "vip") parts.push("VIP");

  if (p.occasion.type !== "none") {
    let line = `אירוע: ${labelById(OCCASION_TYPES, p.occasion.type)}`;
    if (p.occasion.date) line += ` (${p.occasion.date})`;
    if (p.occasion.note.trim()) line += ` — ${p.occasion.note.trim()}`;
    parts.push(line);
  }

  if (p.dietary.tags.length || p.dietary.note.trim()) {
    const tags = p.dietary.tags.map((t) => labelById(DIETARY_TAGS, t)).join(", ");
    parts.push(`תזונה: ${[tags, p.dietary.note.trim()].filter(Boolean).join(" — ")}`);
  }

  if (p.arrival_context.tags.length || p.arrival_context.note.trim()) {
    const tags = p.arrival_context.tags.map((t) => labelById(ARRIVAL_CONTEXT_TAGS, t)).join(", ");
    parts.push(`הקשר הגעה: ${[tags, p.arrival_context.note.trim()].filter(Boolean).join(" — ")}`);
  }

  if (p.staff_note.trim()) parts.push(`הערת צוות: ${p.staff_note.trim()}`);

  if (arrivalTime) parts.push(`שעת הגעה משוערת: ${arrivalTime}`);

  return parts.length ? `פרופיל אורח: ${parts.join(" | ")}` : "";
}

export function toggleTag(tags, tagId) {
  const set = new Set(tags);
  if (set.has(tagId)) set.delete(tagId);
  else set.add(tagId);
  return [...set];
}
