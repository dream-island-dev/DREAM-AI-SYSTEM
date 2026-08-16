// supabase/functions/_shared/guestSegmentGuard.ts
//
// Deno-side mirror of src/utils/guestSegmentGuard.js — central write gate for
// guest room/room_type consistency + duplicate prevention (Mike, P0
// 2026-08-05 — hermetic guest classification). Duplicated across the
// front/back boundary by repo convention (same as suiteNames.ts mirroring
// suiteRegistry.js); when the frontend version changes, update BOTH files.
//
// Split-brain bug class this closes: a guest whose `room` is a canonical
// physical suite (SUITE_REGISTRY) ends up with room_type=day_guest/
// premium_day_guest (or vice versa — a day-pass row gets created for a phone
// that already has an active suite stay covering the date). Every path that
// INSERTs or UPDATEs a `guests` row's room/room_type/phone+arrival_date must
// call these asserts first — Fail Visible: throw with a Hebrew message staff
// can act on, never silently skip or half-write.
//
// Built as a Phase 1 prerequisite for the EZGO live-API sync worker (not yet
// built) — the worker cannot import src/utils/guestSegmentGuard.js directly
// since it runs in Deno, not the frontend bundle.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCanonicalSuiteRoom, isEffectiveSuiteGuest } from "./suiteNames.ts";

export { isCanonicalSuiteRoom };

// ─────────────────────────────────────────────────────────────────────────
// Phone normalization — no Deno-side E.164 normalizer existed yet, so this
// is a direct port of src/utils/ezgoParser.js's normalizeILMobile /
// normalizeWhatsAppPhone / isDummyPhone (not just a reference — self
// contained, per the same duplication convention as suiteNames.ts).
// ─────────────────────────────────────────────────────────────────────────

/** Normalizes Israeli mobile captures to E.164 "+972XXXXXXXXX". */
export function normalizeILMobile(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `+972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `+972${digits}`;
  if (digits.length === 12 && digits.startsWith("972")) return `+${digits}`;
  return null;
}

const REPEATED_DIGIT_RE = /^(\d)\1+$/;
// ITU E.164: country code + subscriber, 8-15 digits (no leading 0 after CC).
const E164_DIGIT_RE = /^[1-9]\d{7,14}$/;

/** Placeholder coordinator phones ("111", "000…") — not real guest numbers. */
export function isDummyPhone(phone: unknown): boolean {
  if (phone == null || phone === "") return true;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return true;
  if (REPEATED_DIGIT_RE.test(digits)) return true;
  return false;
}

/**
 * Normalize any plausible guest phone to E.164. Israeli domestic shapes stay
 * on the IL path; foreign numbers (with +, 00-prefix, or bare digits that
 * already include a country code) are kept. Local-looking numbers without a
 * country code (e.g. bare 10-digit US) stay null — FAIL VISIBLE, staff must
 * add +.
 */
export function normalizeWhatsAppPhone(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const il = normalizeILMobile(trimmed);
  if (il) return il;

  const hadPlus = /^\s*\+/.test(trimmed);
  const digitsRaw = trimmed.replace(/[^\d]/g, "");
  if (!digitsRaw) return null;

  const fromIntlPrefix = digitsRaw.startsWith("00");
  const digits = fromIntlPrefix ? digitsRaw.slice(2) : digitsRaw;

  // 00972… / +972 after 00-strip — same shape as IL international export.
  const ilAfterStrip = normalizeILMobile(digits);
  if (ilAfterStrip) return ilAfterStrip;

  if (!E164_DIGIT_RE.test(digits) || isDummyPhone(digits)) return null;

  // Explicit + / 00 → trust as international E.164.
  if (hadPlus || fromIntlPrefix) return `+${digits}`;

  // Bare digits: only when length already implies a country code (11-15).
  // 8-10 without + is too ambiguous (local national numbers).
  if (digits.length >= 11) return `+${digits}`;

  return null;
}

/** Canonical E.164-ish key for phone-equality checks — falls back to digits-only. */
export function normalizeGuestPhoneForLookup(phone: unknown): string | null {
  if (!phone) return null;
  const e164 = normalizeWhatsAppPhone(phone);
  if (e164) return e164;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits || null;
}

/**
 * guests.phone is stored two ways across this codebase (CLAUDE.md §3):
 * "+972…" (guests table) vs bare digits "972…" (bookings/webhook). A lookup
 * that only tries one form misses the other and lets a split-brain profile
 * slip past the guard — so every DB query below tries both.
 */
export function phoneLookupVariants(phone: unknown): string[] {
  const normalized = normalizeGuestPhoneForLookup(phone);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  if (normalized.startsWith("+")) variants.add(normalized.slice(1));
  else variants.add(`+${normalized}`);
  return [...variants];
}

// ─────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────

export interface GuestSegmentCandidate {
  room?: unknown;
  room_type?: unknown;
}

/** Throws when a canonical suite room is paired with a day-pass room_type. */
export function assertGuestSegmentConsistent({ room, room_type }: GuestSegmentCandidate): void {
  const isDayType = room_type === "day_guest" || room_type === "premium_day_guest";
  if (isDayType && isCanonicalSuiteRoom(room)) {
    const typeLabel = room_type === "premium_day_guest" ? "Premium Day" : "בילוי יומי";
    throw new Error(
      `שילוב לא עקבי: "${room}" הוא חדר סוויטה קנוני אבל סוג האורח הוא ${typeLabel} — לא ניתן לשמור`,
    );
  }
}

/**
 * Hermetic day-pass create gate. A mail/import/API row can be mis-resolved
 * as a day visit for a guest who already has an active suite stay covering
 * that date — that used to insert a phantom "בילוי יומי" duplicate profile,
 * split-brain with the real suite profile. Window-overlap match (not exact
 * arrival_date) so a stray day-pass row anywhere inside an existing
 * multi-night suite stay is still caught, not just an exact-date collision.
 */
export async function assertNoConflictingSuiteProfile(
  supabase: SupabaseClient,
  phone: unknown,
  arrivalDate: string | null | undefined,
): Promise<void> {
  const variants = phoneLookupVariants(phone);
  if (!variants.length || !arrivalDate) return;
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, room, room_type, arrival_date, departure_date")
    .in("phone", variants)
    .neq("status", "cancelled")
    .lte("arrival_date", arrivalDate)
    .or(`departure_date.is.null,departure_date.gte.${arrivalDate}`);
  if (error) throw error;
  const conflict = (data || []).find((g: Record<string, unknown>) => isEffectiveSuiteGuest(g));
  if (conflict) {
    throw new Error(
      `לא ניתן ליצור פרופיל בילוי יומי — קיים כבר פרופיל סוויטה פעיל (${conflict.name || phone}${conflict.room ? ` · ${conflict.room}` : ""}) לאותו טלפון בתאריך זה`,
    );
  }
}

/**
 * Catches a duplicate guest profile the DB's guests_phone_arrival_guestidx_key
 * constraint would NOT — that constraint only blocks an exact phone-string +
 * arrival_date + guest_index collision, so a "+972…" vs "972…" formatting
 * mismatch between two creation paths still slips a second row past it.
 */
export async function assertNoDuplicateGuest(
  supabase: SupabaseClient,
  phone: unknown,
  arrivalDate: string | null | undefined,
  { excludeId }: { excludeId?: number | null } = {},
): Promise<void> {
  const variants = phoneLookupVariants(phone);
  if (!variants.length || !arrivalDate) return;
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, phone, arrival_date, status")
    .in("phone", variants)
    .eq("arrival_date", arrivalDate)
    .neq("status", "cancelled");
  if (error) throw error;
  const dup = (data || []).find((g: { id: number }) => g.id !== excludeId);
  if (dup) {
    throw new Error(
      `כבר קיים פרופיל אורח לאותו טלפון + תאריך הגעה (${dup.name || dup.phone} · ${arrivalDate}, מזהה #${dup.id})`,
    );
  }
}
