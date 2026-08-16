// Import-time automation scope for EZGO mail (Doc2) group/municipal bookings.
//
// Deno-side counterpart to src/utils/ezgoParser.js's resolveImportAutomationScope
// for the manual CSV import path.
// Mike, P0 2026-08-10: reverses the 2026-08-05 decision below — a remark group
// occupant (real person, name+phone parsed off a shared-coordinator booking)
// must get courtesy_only (Stage 4 mid_stay only), the same as the CSV import
// path, not 'muted'. Live 2026-08-10: 14 suite arrivals imported via mail were
// stuck at automation_scope='muted' with msg_mid_stay_sent=false — they should
// have received the Stage 4 courtesy check like every other group occupant.
// A single-row corporate coordinator (no resolved individual occupant) is a
// different case and stays 'muted' — see isCorporateMuteCoordName below.
//
// [2026-08-05, superseded above]: a group/municipal booking imported from mail
// must get ZERO pipeline WhatsApp — 'muted', not the CSV path's 'courtesy_only'.
// Cron stages 1-4 already block on scope='muted' via automationSchedule.ts's
// resolveAutomationScope; room_ready + manual sends stay exempt at whatsapp-send
// (AUTOMATION_MUTE_EXEMPT) — this module only decides what gets written to
// guests.automation_scope at import.

export type ImportAutomationScope = "full" | "courtesy_only" | "muted";

const CORPORATE_MUTE_NAME_RE = /עיריית|עיירית|עירייה|עיריה|מחלקת מכירות|בנק לאומי/;

/** Duplicated (not imported) from ezgoParser.js's isCorporateMuteCoordName —
 * same reasoning as that file's own comment: keeping the two runtimes
 * (browser CSV path / Deno mail path) independent avoids a cross-boundary
 * import. Keep both regexes in sync by hand. */
export function isCorporateMuteCoordName(name: string | null | undefined): boolean {
  return CORPORATE_MUTE_NAME_RE.test(String(name ?? ""));
}

/**
 * Resolve the automation scope for a single Doc2 mail row.
 *   - isRemarkGroupOccupant (coordNameDuplicated=true, i.e. the same coordinator
 *     name appears on 2+ rows) → courtesy_only (Stage 4 mid_stay only), aligned
 *     with the CSV import path (ezgoParser.js resolveImportAutomationScope) —
 *     every row of a shared-coordinator group booking, whether or not remark
 *     parsing resolved an individual occupant for that specific row.
 *   - Single-row corporate coordinator (עיריית/בנק לאומי/…) → muted (zero
 *     pipeline — there is no real individual occupant to reach).
 *   - Otherwise → full.
 */
export function resolveDoc2ImportAutomationScope(opts: {
  coordNameRaw?: string | null;
  isRemarkGroupOccupant: boolean;
}): ImportAutomationScope {
  if (opts.isRemarkGroupOccupant) return "courtesy_only";
  if (isCorporateMuteCoordName(opts.coordNameRaw)) return "muted";
  return "full";
}

/** Restrictiveness rank, mirrors public.merge_automation_scope (migration 154) —
 * used client-side because the Doc2 mail create/enrich path writes directly via
 * the Supabase JS client, not through the sync_suite_arrivals RPC. Never lets an
 * enrichment write loosen an already-muted guest back toward full. */
export function mergeAutomationScope(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): ImportAutomationScope {
  const rank = (s: string | null | undefined): number => {
    if (s === "muted") return 2;
    if (s === "courtesy_only") return 1;
    return 0;
  };
  const r = Math.max(rank(existing), rank(incoming));
  return r === 2 ? "muted" : r === 1 ? "courtesy_only" : "full";
}
