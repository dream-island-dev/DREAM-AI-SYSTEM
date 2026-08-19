// spaTherapistIdentity.js — canonical spa therapist names for CSV/API sync.
// Placeholders from migration 176 ("מטפל/ת 01") are not real staff.
// Duplicate rows (אור vs אור with a different geresh, ג'ין vs גין) collapse
// by match key unless they already have two different EZGO WorkerIds.

const PLACEHOLDER_RE = /^מטפל\/?ת\s*0*\d+$/i;
const FEMALE_ONLY_TAIL_RE = /\s*[-–—]?\s*ל?נשים\s*בלבד\s*$/i;
const LEADING_INDEX_RE = /^\d+\s+/;
const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_TAIL_RE = /^[A-Za-z][A-Za-z0-9.\s_-]*$/;
const GERESH_RE = /[\u05F3\u05F4'’ʻʹ]/g;

export function isPlaceholderTherapistName(name) {
  return PLACEHOLDER_RE.test(String(name ?? "").trim());
}

export function canonicalizeTherapistName(raw) {
  let s = String(raw ?? "")
    .replace(/[\r\n\t\xa0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  s = s.replace(FEMALE_ONLY_TAIL_RE, "").trim();
  s = s.replace(LEADING_INDEX_RE, "").trim();
  const dashParts = s.split(/\s*[-–—]\s*/);
  if (
    dashParts.length === 2
    && HEBREW_RE.test(dashParts[0])
    && LATIN_TAIL_RE.test(dashParts[1].trim())
  ) {
    s = dashParts[0].trim();
  }
  if (!s || isPlaceholderTherapistName(s)) return null;
  return s;
}

export function therapistMatchKey(name) {
  const canonical = canonicalizeTherapistName(name);
  if (!canonical) return "";
  return canonical
    .normalize("NFC")
    .replace(GERESH_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function pickCanonicalTherapistRow(rows) {
  const list = [...(rows ?? [])];
  if (list.length === 0) return null;
  list.sort((a, b) => {
    const aW = a.ezgo_worker_id != null ? 1 : 0;
    const bW = b.ezgo_worker_id != null ? 1 : 0;
    if (bW !== aW) return bW - aW;
    const aLen = String(a.name ?? "").length;
    const bLen = String(b.name ?? "").length;
    if (bLen !== aLen) return bLen - aLen;
    return Number(a.id) - Number(b.id);
  });
  return list[0];
}

export function planTherapistMerges(therapists) {
  const groups = new Map();
  for (const t of therapists ?? []) {
    if (!t || isPlaceholderTherapistName(t.name)) continue;
    const key = therapistMatchKey(t.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const plans = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const workerIds = [...new Set(group.map((t) => t.ezgo_worker_id).filter((id) => id != null))];
    if (workerIds.length > 1) continue;
    const keep = pickCanonicalTherapistRow(group);
    if (!keep) continue;
    const drop = group.filter((t) => t.id !== keep.id);
    if (drop.length) plans.push({ keep, drop });
  }
  return plans;
}

/** Real staff catalog — hide migration-176 placeholders from manage UI. */
export function catalogTherapists(therapists) {
  return (therapists ?? []).filter((t) => !isPlaceholderTherapistName(t.name));
}

/** Assign / roster dropdowns: today's booked therapists, plus roster/assigned extras. */
export function shiftTherapistsForDay(therapists, bookedIds, extraIds = []) {
  const booked = bookedIds instanceof Set ? bookedIds : new Set(bookedIds ?? []);
  const extra = new Set(
    [...(extraIds ?? [])].filter((id) => id != null && id !== "").map((id) => String(id))
  );
  return (therapists ?? []).filter((t) => booked.has(t.id) || extra.has(String(t.id)));
}

export function resolveTherapistIdFromName(rawName, therapists) {
  const canonical = canonicalizeTherapistName(rawName);
  if (!canonical) return null;
  const exact = (therapists ?? []).find((t) => t.name === canonical && t.active !== false);
  if (exact) return exact.id;
  const key = therapistMatchKey(canonical);
  const keyed = (therapists ?? []).filter(
    (t) => t.active !== false && !isPlaceholderTherapistName(t.name) && therapistMatchKey(t.name) === key
  );
  return pickCanonicalTherapistRow(keyed)?.id ?? null;
}
