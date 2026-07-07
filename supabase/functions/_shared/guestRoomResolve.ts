// Resolve canonical suite label for guest_request Whapi cards + tasks.room_number.
// Mirrors src/data/suiteRegistry.js — duplicated at the Deno boundary (CLAUDE.md §3).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUITE_REGISTRY = [
  "ג׳ספר 1", "ג׳ספר 2", "ג׳ספר 3", "ג׳ספר 4", "ג׳ספר 5", "ג׳ספר 6",
  "אוניקס 7", "אמטיסט 8", "אמטיסט 9", "אמטיסט 10", "אמטיסט 11", "אוניקס 12",
  "רובי 13", "רובי 14", "רובי 15", "רובי 16",
  "אמרלד 17", "אמרלד 18", "אמרלד 19", "אמרלד 20",
  "אקווה מרין 21", "אקווה מרין 22", "אקווה מרין 23",
  "אקווה מרין 24", "אקווה מרין 25", "אקווה מרין 26",
] as const;

function _suiteBrandKey(name: string): string {
  return String(name ?? "").trim().replace(/^סוויטת\s+/i, "");
}

export function resolveSuiteFromEzgoFields(
  roomName: string | null | undefined,
  suiteType: string | null | undefined,
  isDayGuest = false,
): string {
  const rn = String(roomName ?? "").trim();
  const st = String(suiteType ?? "").trim();

  if (isDayGuest || /premium\s*day|day\s*guest|בילוי.*יומי/i.test(st)) {
    if (/premium\s*day\s*2|פרימיום.*2|day\s*2/i.test(st)) return "Premium Day 2";
    if (/premium\s*day|פרימיום|day\s*guest|בילוי.*יומי/i.test(st)) return "Premium Day 1";
    return "";
  }

  const num = rn.match(/\d+/)?.[0];
  if (num) {
    const byNum = SUITE_REGISTRY.filter((s) => s.endsWith(" " + num));
    if (byNum.length === 1) return byNum[0];
    if (st) {
      const brand = _suiteBrandKey(st);
      const narrowed = byNum.filter((s) => s.includes(brand) || brand.includes(s.replace(/ \d+$/, "")));
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  if (st) {
    const brand = _suiteBrandKey(st);
    const byType = SUITE_REGISTRY.filter(
      (s) => s.includes(brand) || brand.includes(s.replace(/ \d+$/, "")),
    );
    if (byType.length === 1) return byType[0];
  }

  return "";
}

/** Compare bare number ("14") vs canonical suite ("רובי 14"). Mirrors suiteRegistry.js */
export function roomsCanonicallyMatch(incoming: string, stored: string): boolean {
  const a = String(incoming ?? "").trim();
  const b = String(stored ?? "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const numA = a.match(/(\d+)\s*$/)?.[1] ?? a.match(/^(\d+)$/)?.[1];
  const numB = b.match(/(\d+)\s*$/)?.[1];
  if (numA && numB && numA === numB) return true;
  const canonA = resolveSuiteFromEzgoFields(a, "", false) || a;
  const canonB = resolveSuiteFromEzgoFields(b, "", false) || b;
  return !!(canonA && canonB && canonA === canonB);
}

export function guestRoomMatchesSuiteId(
  guest: { room?: string | null; suite_name?: string | null },
  roomId: string,
): boolean {
  const canon = String(roomId ?? "").trim();
  if (!canon || !guest) return false;
  const room = String(guest.room ?? "").trim();
  const suiteName = String(guest.suite_name ?? "").trim();
  if (room === canon || suiteName === canon) return true;
  if (room && roomsCanonicallyMatch(canon, room)) return true;
  if (suiteName && roomsCanonicallyMatch(canon, suiteName)) return true;
  return false;
}

function phoneLookupVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const e164 = digits.startsWith("972") ? `+${digits}` : `+972${digits.replace(/^0/, "")}`;
  const noPlus = e164.slice(1);
  const local = `0${noPlus.slice(3)}`;
  return [...new Set([phone, e164, noPlus, local])];
}

/** Whapi card label — never bare "—" when we can infer suite from DB. */
export function formatGuestOpsRoomLabel(
  resolvedRoom: string | null | undefined,
  guestName?: string | null,
): string {
  const room = resolvedRoom?.trim();
  if (room) return room;
  const name = guestName?.trim();
  return name ? `TBD — ${name}` : "TBD — guest";
}

/**
 * guests.room → fresh guests row → suite_rooms by phone (latest arrival).
 * Best-effort backfill guests.room when inferred from suite_rooms.
 */
export async function resolveGuestRoomLabel(
  supabase: ReturnType<typeof createClient>,
  args: { guestId: number; phone: string; roomHint?: string | null; guestName?: string | null },
): Promise<string> {
  const hint = args.roomHint?.trim();
  if (hint) return hint;

  const { data: guestRow } = await supabase
    .from("guests")
    .select("room, arrival_date")
    .eq("id", args.guestId)
    .maybeSingle();

  const fromGuest = (guestRow?.room as string | null | undefined)?.trim();
  if (fromGuest) return fromGuest;

  const variants = phoneLookupVariants(args.phone);
  if (!variants.length) return formatGuestOpsRoomLabel(null, args.guestName);

  const { data: suiteRows } = await supabase
    .from("suite_rooms")
    .select("room_name, suite_type, is_day_guest, arrival_date")
    .in("guest_phone", variants)
    .order("arrival_date", { ascending: false })
    .limit(5);

  if (!suiteRows?.length) return formatGuestOpsRoomLabel(null, args.guestName);

  const arrivalYmd = guestRow?.arrival_date as string | null | undefined;
  const pick =
    (arrivalYmd
      ? suiteRows.find((r) => r.arrival_date === arrivalYmd)
      : null) ?? suiteRows[0];

  const resolved = resolveSuiteFromEzgoFields(
    pick.room_name as string | null,
    pick.suite_type as string | null,
    pick.is_day_guest === true,
  );

  let label = resolved;
  if (!label) {
    const st = String(pick.suite_type ?? "").trim();
    const rn = String(pick.room_name ?? "").trim();
    label = [st, rn].filter(Boolean).join(" ").trim();
  }

  if (label) {
    supabase
      .from("guests")
      .update({ room: label })
      .eq("id", args.guestId)
      .then(({ error }) => {
        if (error) {
          console.warn(`[guestRoomResolve] guests.room backfill failed guest:${args.guestId}:`, error.message);
        }
      });
    return label;
  }

  return formatGuestOpsRoomLabel(null, args.guestName);
}
