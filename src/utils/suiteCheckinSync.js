// Unified check-in sync — guests.status + room_status stay aligned (§0.5).
// Deno mirror: supabase/functions/_shared/suiteCheckinSync.ts (keep in sync).

export function resolveGuestRoomId(guest) {
  return String(guest?.room ?? guest?.suite_name ?? "").trim();
}

function auditLine(text) {
  const ts = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
  return `[${ts}] ${text}`;
}

export async function appendGuestNotesAudit(supabase, guestId, existingNotes, line) {
  const prev = String(existingNotes ?? "").trim();
  const next = prev ? `${prev}\n${auditLine(line)}` : auditLine(line);
  const { error } = await supabase.from("guests").update({ guest_notes: next }).eq("id", guestId);
  return error;
}

async function upsertRoomStatus(supabase, roomId, status) {
  const trimmed = String(roomId ?? "").trim();
  if (!trimmed) return { ok: false, error: "אין מזהה חדר" };
  const now = new Date().toISOString();
  const { error } = await supabase.from("room_status").upsert(
    { room_id: trimmed, status, updated_at: now },
    { onConflict: "room_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, roomId: trimmed, roomStatus: status };
}

/** Synced check-in: guests.checked_in + room_status.תפוס */
export async function performSuiteCheckIn(supabase, guest, opts = {}) {
  if (!supabase || !guest?.id) return { ok: false, error: "אורח חסר" };

  const roomId = opts.roomId ?? resolveGuestRoomId(guest);
  const now = new Date().toISOString();
  const guestPatch = {
    status: "checked_in",
    checkin_time: now,
  };

  if (opts.skipRoomReadyMessage) {
    guestPatch.room_ready_notified = true;
  }

  const { error: guestErr } = await supabase.from("guests").update(guestPatch).eq("id", guest.id);
  if (guestErr) return { ok: false, error: guestErr.message };

  if (opts.skipRoomReadyMessage) {
    const noteErr = await appendGuestNotesAudit(
      supabase,
      guest.id,
      guest.guest_notes,
      "צ'ק-אין ידני ללא שליחת הודעת חדר מוכן",
    );
    if (noteErr) return { ok: false, error: noteErr.message };
  }

  if (!roomId) {
    return { ok: true, guestPatch, roomId: null, roomStatus: null, noRoomLinked: true };
  }

  const roomResult = await upsertRoomStatus(supabase, roomId, "תפוס");
  if (!roomResult.ok) return { ok: false, error: roomResult.error, partial: true };

  return {
    ok: true,
    guestPatch,
    roomId: roomResult.roomId,
    roomStatus: roomResult.roomStatus,
    noRoomLinked: false,
  };
}

/** Revert check-in — room_ready if WA already sent, else expected; room → פנוי */
export async function performSuiteCheckInRevert(supabase, guest) {
  if (!supabase || !guest?.id) return { ok: false, error: "אורח חסר" };

  const wasNotified = !!(guest.room_ready_notified || guest.msg_room_ready_sent);
  const revertStatus = wasNotified ? "room_ready" : "expected";
  const guestPatch = { status: revertStatus, checkin_time: null };

  const { error: guestErr } = await supabase.from("guests").update(guestPatch).eq("id", guest.id);
  if (guestErr) return { ok: false, error: guestErr.message };

  const roomId = resolveGuestRoomId(guest);
  if (roomId) {
    const roomResult = await upsertRoomStatus(supabase, roomId, "פנוי");
    if (!roomResult.ok) return { ok: false, error: roomResult.error, partial: true };
  }

  return { ok: true, guestPatch, revertStatus, roomId };
}

/** Skip ממתין לאישור + check-in without WhatsApp */
export async function skipApprovalAndCheckIn(supabase, guest, roomId) {
  return performSuiteCheckIn(supabase, guest, {
    roomId: roomId ?? resolveGuestRoomId(guest),
    skipRoomReadyMessage: true,
  });
}

/** Close approval gate only — room → פנוי, guest unchanged */
export async function releaseApprovalGateOnly(supabase, roomId) {
  if (!roomId) return { ok: false, error: "חדר חסר" };
  return upsertRoomStatus(supabase, roomId, "פנוי");
}

/** Room only — idempotent housekeeping Co when guest already checked_out. */
export async function syncRoomToCleaning(supabase, roomId) {
  return upsertRoomStatus(supabase, roomId, "לניקיון");
}

/** Synced check-out: guests.checked_out + room_status.לניקיון */
export async function performSuiteCheckOut(supabase, guest, opts = {}) {
  if (!supabase || !guest?.id) return { ok: false, error: "אורח חסר" };

  const roomId = opts.roomId ?? resolveGuestRoomId(guest);
  const now = new Date().toISOString();
  const auditSource = opts.auditSource ?? "צ'ק-אאוט מסונכרן";
  const prevNotes = String(guest.guest_notes ?? "").trim();
  const guestPatch = {
    status: "checked_out",
    checked_out_at: now,
    room_ready_notified: false,
    msg_room_ready_sent: false,
    room_ready_at: null,
    guest_notes: prevNotes
      ? `${prevNotes}\n${auditLine(auditSource)}`
      : auditLine(auditSource),
  };

  const { error: guestErr } = await supabase.from("guests").update(guestPatch).eq("id", guest.id);
  if (guestErr) return { ok: false, error: guestErr.message };

  if (!roomId) {
    return { ok: true, guestPatch, roomId: null, roomStatus: null, noRoomLinked: true };
  }

  const roomResult = await upsertRoomStatus(supabase, roomId, "לניקיון");
  if (!roomResult.ok) return { ok: false, error: roomResult.error, partial: true };

  return {
    ok: true,
    guestPatch,
    roomId: roomResult.roomId,
    roomStatus: roomResult.roomStatus,
    noRoomLinked: false,
  };
}

/** After room_ready WA — guest room_ready (not checked_in); skip if already in-house */
export async function markGuestRoomReadyAfterNotify(supabase, guestId) {
  if (!supabase || !guestId) return { ok: false, error: "אורח חסר" };
  const { error } = await supabase
    .from("guests")
    .update({ status: "room_ready" })
    .eq("id", guestId)
    .neq("status", "checked_in");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
