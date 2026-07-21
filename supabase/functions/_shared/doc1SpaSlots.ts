// Doc1 spa slot helpers — multiple treatment times per EZGO mail row.

export type SpaSlot = { time: string; count: number };

export function addSpaSlot(slots: SpaSlot[], time: string, count: number): SpaSlot[] {
  const hit = slots.find((s) => s.time === time);
  const next = hit
    ? slots.map((s) => (s.time === time ? { ...s, count: s.count + count } : s))
    : [...slots, { time, count }];
  return next.sort((a, b) => a.time.localeCompare(b.time));
}

export function mergeSpaSlotArrays(a: SpaSlot[], b: SpaSlot[]): SpaSlot[] {
  let out = [...a];
  for (const slot of b) {
    out = addSpaSlot(out, slot.time, slot.count);
  }
  return out;
}

export function totalTreatmentCount(slots: SpaSlot[]): number {
  return slots.reduce((sum, s) => sum + (s.count || 0), 0);
}

export function earliestSpaTime(slots: SpaSlot[]): string | null {
  if (!slots.length) return null;
  return slots[0].time;
}

export function buildGuestProfileDoc1SlotsPatch(
  existingProfile: Record<string, unknown> | null | undefined,
  slots: SpaSlot[],
  spaDate: string | null,
): Record<string, unknown> {
  const profile = existingProfile && typeof existingProfile === "object" ? existingProfile : {};
  const spa = profile.spa && typeof profile.spa === "object"
    ? (profile.spa as Record<string, unknown>)
    : {};
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

/** Hebrew line for LLM when multiple slots or count > 1. Returns null → use single spa_time display. */
export function formatDoc1SpaSlotsForAi(
  slots: SpaSlot[] | null | undefined,
  spaDate: string | null,
  fallbackTime: string | null,
  treatmentCount: number | null,
): string | null {
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

export function spaSlotsWarningLabel(
  slots: SpaSlot[] | null | undefined,
  treatmentCount: number,
): string | null {
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
