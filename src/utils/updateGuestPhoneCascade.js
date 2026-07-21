// Cascade guest phone change across denormalized tables (Golden Profile key).
// Called from AddGuestModal when staff corrects a mistyped number.

/** E.164 + Meta/bookings digit variants for lookup/update. */
export function guestPhoneLookupVariants(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];
  const il = digits.startsWith("972")
    ? digits
    : digits.startsWith("0")
      ? `972${digits.slice(1)}`
      : digits.length >= 11
        ? digits
        : `972${digits}`;
  const e164 = `+${il}`;
  const bare = il;
  const local = `0${il.slice(3)}`;
  return [...new Set([e164, bare, local, raw])].filter(Boolean);
}

function bookingPhone(e164) {
  return String(e164 ?? "").replace(/^\+/, "");
}

async function assertGuestPhoneAvailable(supabase, { guestId, newPhone, arrivalDate, guestIndex }) {
  if (!newPhone) return;
  let query = supabase
    .from("guests")
    .select("id, name")
    .eq("phone", newPhone)
    .neq("id", guestId);
  if (arrivalDate) query = query.eq("arrival_date", arrivalDate);
  query = query.eq("guest_index", guestIndex ?? 0);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) {
    const who = data.name ? ` (${data.name})` : "";
    throw new Error(`מספר זה כבר משויך לאורח אחר${who} באותו תאריך הגעה`);
  }
}

async function assertClubPhoneAvailable(supabase, { guestId, newPhone }) {
  if (!newPhone) return;
  const { data, error } = await supabase
    .from("guest_club_members")
    .select("id, guest_id")
    .eq("phone", newPhone)
    .maybeSingle();
  if (error) throw error;
  if (data && data.guest_id != null && data.guest_id !== guestId) {
    throw new Error("מספר זה כבר רשום במועדון האורחים תחת פרופיל אחר");
  }
}

/** Read-only checks — run before guests.phone UPDATE. */
export async function preflightGuestPhoneChange(supabase, {
  guestId,
  oldPhone,
  newPhone,
  arrivalDate,
  guestIndex = 0,
}) {
  const normalizedNew = newPhone || null;
  const normalizedOld = oldPhone || null;
  if (!normalizedOld || normalizedOld === normalizedNew) return { ok: true };
  try {
    await assertGuestPhoneAvailable(supabase, {
      guestId,
      newPhone: normalizedNew,
      arrivalDate,
      guestIndex,
    });
    await assertClubPhoneAvailable(supabase, { guestId, newPhone: normalizedNew });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * @returns {{ ok: true, newPhone: string|null } | { ok: false, error: string }}
 */
export async function updateGuestPhoneCascade(supabase, {
  guestId,
  oldPhone,
  newPhone,
  arrivalDate,
  guestIndex = 0,
}) {
  if (!supabase || !guestId) return { ok: false, error: "חסר מזהה אורח" };
  const normalizedNew = newPhone || null;
  const normalizedOld = oldPhone || null;
  if (!normalizedOld || normalizedOld === normalizedNew) {
    return { ok: true, newPhone: normalizedNew };
  }

  try {
    await assertGuestPhoneAvailable(supabase, {
      guestId,
      newPhone: normalizedNew,
      arrivalDate,
      guestIndex,
    });
    await assertClubPhoneAvailable(supabase, { guestId, newPhone: normalizedNew });

    const oldVariants = guestPhoneLookupVariants(normalizedOld);
    const bookingNew = normalizedNew ? bookingPhone(normalizedNew) : null;
    const bookingOldVariants = oldVariants.map(bookingPhone);

    const { error: suiteErr } = await supabase
      .from("suite_rooms")
      .update({ guest_phone: normalizedNew })
      .eq("guest_id", guestId);
    if (suiteErr) throw suiteErr;

    const { error: alertsErr } = await supabase
      .from("guest_alerts")
      .update({ phone: normalizedNew })
      .eq("guest_id", guestId);
    if (alertsErr) throw alertsErr;

    const { error: convByGuestErr } = await supabase
      .from("whatsapp_conversations")
      .update({ phone: normalizedNew })
      .eq("guest_id", guestId);
    if (convByGuestErr) throw convByGuestErr;

    if (oldVariants.length) {
      const { error: convByPhoneErr } = await supabase
        .from("whatsapp_conversations")
        .update({ phone: normalizedNew, guest_id: guestId })
        .in("phone", oldVariants)
        .is("guest_id", null);
      if (convByPhoneErr) throw convByPhoneErr;

      const { error: cursorErr } = await supabase
        .from("inbox_read_cursors")
        .update({ phone: normalizedNew })
        .in("phone", oldVariants);
      if (cursorErr) throw cursorErr;
    }

    if (bookingNew && bookingOldVariants.length) {
      let bookingQuery = supabase
        .from("bookings")
        .update({ phone: bookingNew })
        .in("phone", bookingOldVariants);
      if (arrivalDate) bookingQuery = bookingQuery.eq("arrival_date", arrivalDate);
      const { error: bookingErr } = await bookingQuery;
      if (bookingErr) throw bookingErr;
    }

    if (normalizedNew) {
      const { data: clubRow } = await supabase
        .from("guest_club_members")
        .select("id")
        .eq("guest_id", guestId)
        .maybeSingle();
      if (clubRow?.id) {
        const { error: clubErr } = await supabase
          .from("guest_club_members")
          .update({ phone: normalizedNew })
          .eq("guest_id", guestId);
        if (clubErr) throw clubErr;
      } else if (oldVariants.length) {
        const { error: clubByPhoneErr } = await supabase
          .from("guest_club_members")
          .update({ phone: normalizedNew, guest_id: guestId })
          .in("phone", oldVariants);
        if (clubByPhoneErr) throw clubByPhoneErr;
      }
    }

    return { ok: true, newPhone: normalizedNew };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
