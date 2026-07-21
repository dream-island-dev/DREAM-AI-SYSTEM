// Mirror of supabase/functions/_shared/doc1SpaSlots.ts (frontend).

/** @typedef {{ time: string, count: number }} SpaSlot */

/** @param {SpaSlot[]} slots @param {string} time @param {number} count */
export function addSpaSlot(slots, time, count) {
  const hit = slots.find((s) => s.time === time);
  const next = hit
    ? slots.map((s) => (s.time === time ? { ...s, count: s.count + count } : s))
    : [...slots, { time, count }];
  return next.sort((a, b) => a.time.localeCompare(b.time));
}

/** @param {SpaSlot[]} a @param {SpaSlot[]} b */
export function mergeSpaSlotArrays(a, b) {
  let out = [...a];
  for (const slot of b) {
    out = addSpaSlot(out, slot.time, slot.count);
  }
  return out;
}

/** @param {SpaSlot[]} slots */
export function totalTreatmentCount(slots) {
  return slots.reduce((sum, s) => sum + (s.count || 0), 0);
}

/** @param {SpaSlot[]} slots */
export function earliestSpaTime(slots) {
  if (!slots.length) return null;
  return slots[0].time;
}

export function buildGuestProfileDoc1SlotsPatch(existingProfile, slots, spaDate) {
  const profile = existingProfile && typeof existingProfile === "object" ? existingProfile : {};
  const spa = profile.spa && typeof profile.spa === "object" ? profile.spa : {};
  return {
    ...profile,
    spa: {
      ...spa,
      doc1_slots: slots,
      doc1_slots_date: spaDate,
      doc1_slots_imported_at: new Date().toISOString(),
    },
  };
}

export function formatDoc1SpaSlotsForAi(slots, spaDate, fallbackTime, treatmentCount) {
  const valid = (slots ?? []).filter((s) => s?.time && s.count > 0);
  const datePrefix = spaDate ? `${spaDate} · ` : "";

  if (valid.length > 1) {
    const parts = valid.map((s) => (s.count > 1 ? `${s.time} (×${s.count})` : s.time));
    return `${datePrefix}${parts.join(", ")}`;
  }
  if (valid.length === 1 && valid[0].count > 1) {
    return `${datePrefix}${valid[0].time} (${valid[0].count} טיפולים)`;
  }
  const tc = treatmentCount ?? (valid.length ? valid[0].count : 0);
  if (tc > 1 && fallbackTime) {
    return `${datePrefix}${fallbackTime} (${tc} טיפולים)`;
  }
  return null;
}

export function spaSlotsWarningLabel(slots, treatmentCount) {
  const valid = (slots ?? []).filter((s) => s?.time);
  const tc = treatmentCount || totalTreatmentCount(valid);
  if (valid.length > 1) {
    return `⚠ ${tc} טיפולים · ${valid.length} שעות`;
  }
  if (tc > 1) {
    return `⚠ ${tc} טיפולים · שעה ${valid[0]?.time ?? "?"}`;
  }
  return null;
}
