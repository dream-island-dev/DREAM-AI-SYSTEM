// Inbox-selected suite room — stored in guests.guest_profile.inbox.selected_suite_room

export function readInboxSelectedSuiteRoom(guestProfile: unknown): string | null {
  if (!guestProfile || typeof guestProfile !== "object") return null;
  const inbox = (guestProfile as Record<string, unknown>).inbox;
  if (!inbox || typeof inbox !== "object") return null;
  const v = String((inbox as Record<string, unknown>).selected_suite_room ?? "").trim();
  return v || null;
}

export function isAmbiguousCombinedRoomLabel(room: string | null | undefined): boolean {
  return String(room ?? "").includes(" · ");
}
