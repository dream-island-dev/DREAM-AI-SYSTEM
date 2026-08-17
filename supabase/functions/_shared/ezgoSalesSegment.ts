// EZGO Order.SalesSegment — numeric on the API, Hebrew on CSV/UI.

export type SalesSegmentKind = "unmapped" | "individual" | "direct_group" | "other";

export type SalesSegmentMapRow = {
  ezgo_segment_id: number;
  kind: SalesSegmentKind;
  label?: string;
};

export function parseEzgoSalesSegmentId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function kindFromSalesSegmentLabel(raw: unknown): SalesSegmentKind | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/קבוצות\s*ישירות/.test(s)) return "direct_group";
  if (/^בודדים$/.test(s)) return "individual";
  const asId = parseEzgoSalesSegmentId(s);
  if (asId != null) return null;
  return "other";
}

export function kindFromSegmentMap(
  segmentId: number | null,
  map: Map<number, SalesSegmentKind>,
): SalesSegmentKind {
  if (segmentId == null) return "unmapped";
  return map.get(segmentId) ?? "unmapped";
}

export function automationScopeFromSalesSegmentKind(
  kind: SalesSegmentKind,
): "full" | "courtesy_only" | null {
  if (kind === "direct_group") return "courtesy_only";
  return null;
}

export function buildSalesSegmentKindMap(
  rows: Array<{ ezgo_segment_id?: unknown; kind?: unknown }>,
): Map<number, SalesSegmentKind> {
  const map = new Map<number, SalesSegmentKind>();
  for (const row of rows) {
    const id = parseEzgoSalesSegmentId(row.ezgo_segment_id);
    const kind = String(row.kind ?? "unmapped") as SalesSegmentKind;
    if (id == null) continue;
    if (kind === "individual" || kind === "direct_group" || kind === "other" || kind === "unmapped") {
      map.set(id, kind);
    }
  }
  return map;
}
