// Staff Whapi group message ingest — shared by whapi-webhook.
// ZERO DATA LOSS: every inbound human group message is logged, including chitchat.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SUITES_ROOM_SERVICE_GROUP_ID } from "./futureSuiteRoomServiceRouting.ts";
import {
  FRONT_DESK_PHONE_DIGITS,
  CEO_PHONE_DIGITS,
  ARCHITECT_PHONE_DIGITS,
  normalizeExecutivePhoneDigits,
} from "./executiveIdentity.ts";

export type StaffGroupKey = "ops_calls" | "housekeeping" | "guest_requests" | "managers" | "other";

export type StaffMessageKind = "text" | "voice" | "reaction" | "image" | "other";

export type OperationalKind =
  | "chitchat"
  | "task_open"
  | "task_resolve_reaction"
  | "hk_ready"
  | "hk_check_in"
  | "hk_check_out"
  | "hk_unparsed";

/** Canonical Hebrew display names for known ops phones (mirrors whapi-webhook ADMIN_WHITELIST). */
export const KNOWN_STAFF_DISPLAY_NAMES: Record<string, string> = {
  [CEO_PHONE_DIGITS]: "אליעד",
  [ARCHITECT_PHONE_DIGITS]: "מייק",
  [FRONT_DESK_PHONE_DIGITS]: "אדיר",
  "972504654306": "לידור",
  "972502278833": "אסנת",
};

export function resolveStaffGroupKey(chatId: string): StaffGroupKey {
  const id = String(chatId ?? "").trim();
  const ops = (Deno.env.get("WHAPI_GROUP_ID") ?? "").trim();
  const hk = (Deno.env.get("WHAPI_HOUSEKEEPING_GROUP_ID") ?? "").trim();
  const requests = (Deno.env.get("WHAPI_REQUESTS_GROUP_ID") ?? "").trim();
  if (ops && id === ops) return "ops_calls";
  if (hk && id === hk) return "housekeeping";
  if (requests && id === requests) return "guest_requests";
  if (id === SUITES_ROOM_SERVICE_GROUP_ID) return "managers";
  return "other";
}

export function normalizeStaffPhoneDigits(phone: string): string {
  return normalizeExecutivePhoneDigits(phone);
}

export function displayNameForStaffPhone(phoneDigits: string): string | null {
  const d = normalizeStaffPhoneDigits(phoneDigits);
  return KNOWN_STAFF_DISPLAY_NAMES[d] ?? null;
}

/** profiles.phone lookup — same variants as whapi-webhook task reporter attribution. */
export async function resolveStaffProfileByPhone(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<{ id: string; displayName: string | null } | null> {
  const d = normalizeStaffPhoneDigits(phoneDigits);
  if (!d) return null;
  const local = d.startsWith("972") ? "0" + d.slice(3) : d;
  const { data } = await supabase
    .from("profiles")
    .select("id, name, phone")
    .in("phone", [d, "+" + d, local])
    .maybeSingle();
  if (!data?.id) return null;
  const name = String((data as { name?: string | null }).name ?? "").trim() || null;
  return { id: data.id as string, displayName: name };
}

export function resolvePersonKey(phoneDigits: string | null | undefined, fromName: string | null | undefined): string {
  const d = normalizeStaffPhoneDigits(phoneDigits ?? "");
  if (d) {
    const known = KNOWN_STAFF_DISPLAY_NAMES[d];
    if (known) return known;
    return `phone:${d}`;
  }
  const name = String(fromName ?? "").trim();
  return name ? `name:${name.toLowerCase()}` : "unknown";
}

export function personMatchesFilter(
  personFilter: string,
  phoneDigits: string | null | undefined,
  fromName: string | null | undefined,
  displayName?: string | null,
): boolean {
  const needle = String(personFilter ?? "").trim().toLowerCase();
  if (!needle) return true;
  const aliases: Record<string, string[]> = {
    אדיר: ["adir", "972546294885"],
    אליעד: ["eliad", "972505421751"],
    מייק: ["mike", "972506842439"],
    לידור: ["lidor", "972504654306"],
    אסנת: ["osnat", "972502278833"],
  };
  const haystacks = [
    displayName,
    fromName,
    displayNameForStaffPhone(phoneDigits ?? ""),
    phoneDigits,
  ]
    .map((s) => String(s ?? "").toLowerCase())
    .filter(Boolean);
  for (const [he, en] of Object.entries(aliases)) {
    if (needle === he.toLowerCase() || en.some((e) => needle.includes(e))) {
      return haystacks.some((h) => h.includes(he) || en.some((e) => h.includes(e)));
    }
  }
  return haystacks.some((h) => h.includes(needle));
}

export type IngestStaffGroupMessageOpts = {
  waMessageId: string;
  chatId: string;
  fromPhone: string;
  fromName: string;
  messageKind: StaffMessageKind;
  bodyPreview?: string | null;
  isOperational: boolean;
  operationalKind?: OperationalKind | null;
  profileId?: string | null;
  createdAt?: string;
};

/** Insert-first dedup — failures are logged, never block the webhook pipeline. */
export async function ingestStaffGroupMessage(
  supabase: SupabaseClient,
  opts: IngestStaffGroupMessageOpts,
): Promise<{ logged: boolean; duplicate?: boolean }> {
  const waMessageId = String(opts.waMessageId ?? "").trim();
  if (!waMessageId) return { logged: false };

  const groupKey = resolveStaffGroupKey(opts.chatId);
  const fromPhone = normalizeStaffPhoneDigits(opts.fromPhone) || null;

  let profileId = opts.profileId ?? null;
  if (!profileId && fromPhone) {
    const prof = await resolveStaffProfileByPhone(supabase, fromPhone);
    profileId = prof?.id ?? null;
  }

  const preview = String(opts.bodyPreview ?? "").slice(0, 500) || null;

  const { error } = await supabase.from("staff_group_messages").insert({
    wa_message_id: waMessageId,
    chat_id: opts.chatId,
    group_key: groupKey,
    from_phone: fromPhone,
    from_name: String(opts.fromName ?? "").trim() || null,
    profile_id: profileId,
    message_kind: opts.messageKind,
    body_preview: preview,
    is_operational: opts.isOperational,
    operational_kind: opts.operationalKind ?? null,
    ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
  });

  if (error) {
    if (error.code === "23505") return { logged: false, duplicate: true };
    console.warn("[staffGroupIngest] insert failed:", error.message);
    return { logged: false };
  }
  return { logged: true };
}

export type HousekeepingSender = {
  fromPhone?: string | null;
  fromName?: string | null;
  profileId?: string | null;
};

/** Resolve sender once per housekeeping inbound message — pass to all room signals. */
export async function resolveHousekeepingSender(
  supabase: SupabaseClient,
  fromPhone: string,
  fromName: string,
): Promise<HousekeepingSender> {
  const d = normalizeStaffPhoneDigits(fromPhone);
  const prof = d ? await resolveStaffProfileByPhone(supabase, d) : null;
  return {
    fromPhone: d || null,
    fromName: String(fromName ?? "").trim() || null,
    profileId: prof?.id ?? null,
  };
}
