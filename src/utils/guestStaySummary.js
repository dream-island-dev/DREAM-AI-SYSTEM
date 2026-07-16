// Stay summary helpers — booking type inference, suite_rooms fetch, room labels.

import { resolveSuiteFromEzgoFields } from "../data/suiteRegistry";

const IL_MOBILE_IN_TEXT =
  /(?:^|[^\d])(?:\+?972[\s-]?|0)(?:5[0-9])[\s-]?\d{3}[\s-]?\d{4}(?:[^\d]|$)/;

/** Remark contains occupant name + phone → group booking (EZGO sRemark pattern). */
export function remarkContainsOccupantIdentity(remarkText) {
  const text = (remarkText ?? "").trim();
  if (!text) return false;
  if (!IL_MOBILE_IN_TEXT.test(text)) return false;
  const withoutPhone = text.replace(IL_MOBILE_IN_TEXT, " ").trim();
  return /[\u0590-\u05FFa-zA-Z]{2,}/.test(withoutPhone);
}

/**
 * @param {{ guest_notes?: string, guest_profile?: object }} guest
 * @returns {"private"|"group"}
 */
export function inferBookingTypeFromGuest(guest) {
  const override = guest?.guest_profile?.stay?.booking_type;
  if (override === "private" || override === "group") return override;
  if (remarkContainsOccupantIdentity(guest?.guest_notes)) return "group";
  return "private";
}

export function bookingTypeLabel(type) {
  if (type === "group") return "קבוצה / הזמנה משותפת";
  return "לקוח פרטי";
}

export function formatSuiteRoomLine(row) {
  if (!row) return "חדר";
  const resolved = resolveSuiteFromEzgoFields(row.room_name, row.suite_type);
  const label = (typeof resolved === "string" && resolved) || row.suite_type || row.room_name || "חדר";
  const adults = row.adults > 1 ? ` · ${row.adults} אורחים` : "";
  return `${label}${adults}`;
}

const SUITE_ROOM_SELECT =
  "id, guest_id, res_line_id, order_number, room_name, suite_type, room_display, adults, nights, arrival_date, room_ready_notified, msg_room_ready_sent, is_day_guest";

export async function fetchGuestSuiteRooms(supabase, guest) {
  if (!supabase || !guest) return [];

  if (guest.id) {
    const { data: byGuestId, error: byGuestErr } = await supabase
      .from("suite_rooms")
      .select(SUITE_ROOM_SELECT)
      .eq("guest_id", guest.id)
      .order("res_line_id", { ascending: true });
    if (!byGuestErr && byGuestId?.length) return byGuestId;
  }

  let query = supabase
    .from("suite_rooms")
    .select(SUITE_ROOM_SELECT)
    .order("res_line_id", { ascending: true });

  if (guest.order_number && guest.arrival_date) {
    query = query
      .eq("order_number", guest.order_number)
      .eq("arrival_date", guest.arrival_date);
  } else if (guest.phone) {
    query = query.eq("guest_phone", guest.phone);
    if (guest.arrival_date) query = query.eq("arrival_date", guest.arrival_date);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[fetchGuestSuiteRooms]", error.message);
    return [];
  }
  return data ?? [];
}
