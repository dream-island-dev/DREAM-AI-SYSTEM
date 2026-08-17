// deno-lint-ignore-file no-explicit-any
// Ops-group "no answer" at the door → guest Whapi ping.
// Staff: "5 no answer" / "אין מענה" or reply to the task card with that phrase.

type SupabaseClient = any;

import { isDuplicateGuestOutboundRecently } from "./guestInboundBurst.ts";
import { isGuestActiveForOutbound } from "./guestOutboundGuard.ts";
import { findActiveGuestForSuite } from "./housekeepingGuestLookup.ts";
import { hasDialableGuestPhone } from "./metaPhone.ts";
import { formatWhapiSuitesConversationLog } from "./outboundDispatchTag.ts";
import { cleanPhoneForMention } from "./whapiSend.ts";
import { sendWhapiTextGuarded, WhapiRateLimitedError } from "./whapiVelocityGuard.ts";

export const DEFAULT_OPS_NO_ANSWER_GUEST_TEXT =
  "היי, היינו אצלכם מחוץ לחדר ולא היה מענה. אנחנו כאן לשירותכם 🙏";

const NO_ANSWER_RE =
  /(?:no[\s_-]*answer|אין[\s_-]*מענה|לא\s+היה\s+מענה|אין\s+תשובה)/i;

const TASK_CARD_SUITE_RE = /📌\s*Suite\s+(.+)/i;

export function isOpsNoAnswerText(text: string): boolean {
  return NO_ANSWER_RE.test(String(text ?? "").trim());
}

/** Bare room numbers 1–26 left after stripping the no-answer phrase. */
export function parseOpsNoAnswerRoomIds(text: string): string[] {
  const stripped = String(text ?? "").replace(NO_ANSWER_RE, " ").trim();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of stripped.matchAll(/\b(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (n < 1 || n > 26) continue;
    const id = String(n);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function parseSuiteLabelFromTaskCard(quotedText: string): string | null {
  const m = String(quotedText ?? "").match(TASK_CARD_SUITE_RE);
  const label = m?.[1]?.trim().split("\n")[0]?.trim() ?? "";
  return label && label !== "—" ? label : null;
}

export function roomIdFromSuiteLabel(label: string | null | undefined): string | null {
  const n = String(label ?? "").trim().match(/(\d{1,2})\s*$/)?.[1];
  if (!n) return null;
  const num = Number(n);
  if (num < 1 || num > 26) return null;
  return String(num);
}

export function extractWhapiQuotedRef(raw: Record<string, unknown>): { id: string; text: string } {
  const ctx = (raw.context && typeof raw.context === "object")
    ? raw.context as Record<string, unknown>
    : {};
  const nestedRaw = raw.quoted_message ?? raw.quoted ?? ctx.quoted_message;
  const nested = (nestedRaw && typeof nestedRaw === "object")
    ? nestedRaw as Record<string, unknown>
    : undefined;
  const id = String(
    raw.quoted_id
      ?? nested?.id
      ?? ctx.quoted_id
      ?? ctx.id
      ?? "",
  ).trim();
  const textObj = (nested?.text ?? {}) as Record<string, unknown>;
  const text = String(
    textObj.body
      ?? nested?.body
      ?? nested?.caption
      ?? "",
  ).trim();
  return { id, text };
}

export type OpsNoAnswerDispatch =
  | { ok: true; roomId: string; guestId: number; sent: true }
  | { ok: false; roomId: string; reason: "no_guest" | "ambiguous" | "no_phone" | "inactive" | "rate_limited" | "send_failed" };

export async function resolveOpsNoAnswerGuestText(
  supabase: SupabaseClient,
): Promise<string> {
  const { data } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", "ops_no_answer")
    .maybeSingle();
  const custom = String(data?.message_text ?? "").trim();
  return custom || DEFAULT_OPS_NO_ANSWER_GUEST_TEXT;
}

export async function dispatchOpsNoAnswerForRoom(
  supabase: SupabaseClient,
  roomId: string,
  guestText: string,
): Promise<OpsNoAnswerDispatch> {
  const pick = await findActiveGuestForSuite(supabase, roomId);
  if (!pick.guest && pick.ambiguous.length > 1) {
    return { ok: false, roomId, reason: "ambiguous" };
  }
  const guest = pick.guest;
  if (!guest) return { ok: false, roomId, reason: "no_guest" };
  if (!isGuestActiveForOutbound(guest)) return { ok: false, roomId, reason: "inactive" };
  if (!hasDialableGuestPhone(guest.phone)) return { ok: false, roomId, reason: "no_phone" };

  const phone = String(guest.phone);
  const body = guestText.trim();
  if (await isDuplicateGuestOutboundRecently(supabase, phone, body, "whapi")) {
    return { ok: true, roomId, guestId: guest.id, sent: true };
  }
  try {
    const wamid = await sendWhapiTextGuarded(supabase, cleanPhoneForMention(phone), body, {
      sendClass: "guest",
      trigger: "ops_no_answer",
      source: "whapi-webhook",
    });
    const { error } = await supabase.from("whatsapp_conversations").insert({
      phone,
      guest_id: guest.id,
      direction: "outbound",
      message: formatWhapiSuitesConversationLog(body),
      wa_message_id: wamid,
      inbox_channel: "whapi",
      channel: "whapi",
    });
    if (error) console.warn("[opsNoAnswer] inbox log failed:", error.message);
    return { ok: true, roomId, guestId: guest.id, sent: true };
  } catch (e) {
    if (e instanceof WhapiRateLimitedError) {
      return { ok: false, roomId, reason: "rate_limited" };
    }
    console.warn("[opsNoAnswer] send failed:", (e as Error).message);
    return { ok: false, roomId, reason: "send_failed" };
  }
}

export function buildOpsNoAnswerGroupAck(results: OpsNoAnswerDispatch[]): string {
  const lines = results.map((r) => {
    if (r.ok) return `✉️ נשלח לאורח — חדר ${r.roomId}`;
    if (r.reason === "no_guest") return `⚠️ אין אורח פעיל בחדר ${r.roomId}`;
    if (r.reason === "ambiguous") return `⚠️ כמה אורחים בחדר ${r.roomId} — ציינו שם`;
    if (r.reason === "no_phone") return `⚠️ אין טלפון לאורח בחדר ${r.roomId}`;
    if (r.reason === "inactive") return `⚠️ אורח בחדר ${r.roomId} לא פעיל לשליחה`;
    if (r.reason === "rate_limited") return `⚠️ לא נשלח (הגבלת קצב) — חדר ${r.roomId}`;
    return `⚠️ שליחה נכשלה — חדר ${r.roomId}`;
  });
  return lines.join("\n");
}
