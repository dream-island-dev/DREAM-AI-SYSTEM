// Shared Doc2 import line ↔ guests row phone gate (group bookings share order_number).

export function doc2RecordMatchesGuest(
  rec: { phone?: string | null },
  guest: { phone?: string | null },
): boolean {
  const recPhone = rec.phone || null;
  const guestPhone = guest.phone || null;
  if (!recPhone) return true;
  if (!guestPhone) return false;
  return recPhone === guestPhone;
}
