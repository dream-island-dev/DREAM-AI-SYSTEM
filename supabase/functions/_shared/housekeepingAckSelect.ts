// Shared ack-line selection for the housekeeping WA group (ready/check-in/check-out).
//
// Fail Visible (CLAUDE.md §0): genuine failures/uncertainty always post to the group
// regardless of HOUSEKEEPING_WA_GROUP_REPLY — a housekeeping signal that silently
// fails to update the DB is exactly the "row dropped without a trace" case that
// principle exists to prevent. Plain success confirmations ("updated",
// "already_checked_in", etc.) stay opt-in behind the flag so the group doesn't get
// chattier than staff want for routine, working signals.

export function selectHousekeepingAckLines<T extends { action: string }>(
  signals: T[],
  buildLine: (r: T) => string | null,
  alwaysVisibleActions: ReadonlySet<string>,
  hkGroupReply: boolean,
): string[] {
  return signals
    .filter((r) => hkGroupReply || alwaysVisibleActions.has(r.action))
    .map(buildLine)
    .filter((l): l is string => !!l);
}
