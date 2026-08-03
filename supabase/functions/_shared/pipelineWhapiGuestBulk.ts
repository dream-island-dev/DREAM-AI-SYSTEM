// ACC / staff bulk Whapi pipeline enqueue — builds per-guest session bodies
// (same substitutions as whatsapp-send BRANCH D) and enqueues paced jobs
// instead of browser for-loops that trip whapiVelocityGuard.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import { ensureArrivalConfirmationCta, loadStage1AutoAppendCta } from "./arrivalConfirmation.ts";
import { ensureDaypassWindowOpenerCta } from "./daypassWindowOpener.ts";
import { normalizeHmTime } from "./spaSchedule.ts";
import { isEffectiveDayPassGuest, type GuestRoomFields } from "./suiteNames.ts";
import { normalizeOritGuestPhoneDigits } from "./oritGuestOutbound.ts";
import { enqueueWhapiBulkJob, type WhapiBulkRecipient } from "./whapiOutboundQueue.ts";

const PORTAL_BASE_URL = (Deno.env.get("PORTAL_BASE_URL") ?? "https://dream-ai-system.vercel.app").replace(/\/$/, "");

export const PIPELINE_SESSION_SCRIPT: Record<string, string> = {
  pre_arrival_2d: "pre_arrival_2d",
  night_before: "night_before_reminder",
  night_before_daypass: "night_before_daypass",
  morning_suite: "stage_3_morning",
  morning_welcome: "morning_daypass",
  mid_stay: "mid_stay",
  mid_stay_daypass: "mid_stay_daypass",
  checkout_fb: "checkout_fb",
  checkout_fb_daypass: "checkout_fb_daypass",
  spa_warmup_daypass: "spa_warmup_daypass",
  survey_invite_daypass: "survey_invite_daypass",
  spa_upsell_daypass: "spa_upsell_daypass",
  guest_club_invite: "guest_club_invite",
};

const RESORT_ENTRY_TIME = "12:00";
const WEEKDAY_CHECKIN_TIME = "15:00";
const SHABBAT_CHECKIN_TIME = "18:00";

function normalizeArrivalDateYmd(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

function isShabbatArrivalDate(arrivalDateStr: string, specialDatesCsv = ""): boolean {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  if (!ymd) return false;
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCDay() === 6) return true;
  const listed = specialDatesCsv.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  return listed.includes(ymd);
}

function isNightBeforeShabbatBundleArrival(arrivalDateStr: string, specialDatesCsv: string): boolean {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  if (!ymd) return false;
  const d = new Date(`${ymd}T12:00:00Z`);
  const isFriday = !Number.isNaN(d.getTime()) && d.getUTCDay() === 5;
  return isFriday || isShabbatArrivalDate(ymd, specialDatesCsv);
}

function applySaturdayCheckInTimeOverride(messageText: string, arrivalDateStr: string): string {
  if (!messageText || !arrivalDateStr) return messageText;
  if (!isShabbatArrivalDate(arrivalDateStr)) return messageText;
  return messageText.replace(/15:00/g, SHABBAT_CHECKIN_TIME);
}

function resolveShabbatAwareScriptKey(
  stageRow: { session_message_script_key?: string | null; session_message_script_key_shabbat?: string | null } | null,
  isShabbat: boolean,
  fallbackKey: string,
): string {
  if (!isShabbat) return stageRow?.session_message_script_key?.trim() || fallbackKey;
  const shabbatKey = stageRow?.session_message_script_key_shabbat?.trim();
  return shabbatKey || stageRow?.session_message_script_key?.trim() || fallbackKey;
}

async function fetchNightBeforeKnowledge(supabase: SupabaseClient): Promise<Record<string, string>> {
  const keys = [
    "night_before_entry_time_weekday", "night_before_checkin_time_weekday",
    "night_before_entry_time_shabbat", "night_before_checkin_time_shabbat",
    "night_before_special_dates",
  ];
  const { data } = await supabase.from("bot_config").select("config_key, config_value").in("config_key", keys);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { config_key: string; config_value: string }[]) {
    map[row.config_key] = row.config_value ?? "";
  }
  return map;
}

function resolveArrivalTimingsFromCfg(
  cfg: Record<string, string>,
  arrivalDateStr: string,
): { entryTime: string; checkInTime: string } {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  const special = isShabbatArrivalDate(ymd, cfg["night_before_special_dates"] ?? "");
  if (special) {
    return {
      entryTime: (cfg["night_before_entry_time_shabbat"] ?? "").trim() || RESORT_ENTRY_TIME,
      checkInTime: (cfg["night_before_checkin_time_shabbat"] ?? "").trim() || SHABBAT_CHECKIN_TIME,
    };
  }
  return {
    entryTime: (cfg["night_before_entry_time_weekday"] ?? "").trim() || RESORT_ENTRY_TIME,
    checkInTime: (cfg["night_before_checkin_time_weekday"] ?? "").trim() || WEEKDAY_CHECKIN_TIME,
  };
}

export async function buildPipelineWhapiSessionBody(
  supabase: SupabaseClient,
  guest: Record<string, unknown>,
  trigger: string,
  stageRow: { session_message_script_key?: string | null; session_message_script_key_shabbat?: string | null } | null,
  opts?: { stage1AutoAppendCta?: boolean; nightBeforeCfg?: Record<string, string> },
): Promise<string | null> {
  const pipelineScriptFallback = PIPELINE_SESSION_SCRIPT[trigger] ?? "";
  if (!pipelineScriptFallback && !stageRow?.session_message_script_key) return null;

  const arrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
  const isShabbat = trigger === "night_before"
    ? isNightBeforeShabbatBundleArrival(arrivalYmd, opts?.nightBeforeCfg?.["night_before_special_dates"] ?? "")
    : isShabbatArrivalDate(arrivalYmd);

  const pipelineScriptKey = resolveShabbatAwareScriptKey(stageRow, isShabbat, pipelineScriptFallback);
  const { data: scriptRow } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", pipelineScriptKey)
    .maybeSingle();
  const rawText = scriptRow?.message_text?.trim();
  if (!rawText) return null;

  const guestName = String(guest.name ?? "").trim() || "אורח יקר";
  const portalUrl = guest.portal_token
    ? `${PORTAL_BASE_URL}/portal/${String(guest.portal_token)}`
    : "";

  let body = rawText
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName)
    .replace(/\{\{\s*portal_url\s*\}\}/gi, portalUrl)
    .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, normalizeHmTime(guest.spa_time) || "");

  if (trigger === "night_before" || trigger === "night_before_daypass") {
    const cfg = opts?.nightBeforeCfg ?? await fetchNightBeforeKnowledge(supabase);
    const { entryTime, checkInTime } = resolveArrivalTimingsFromCfg(cfg, arrivalYmd);
    body = body
      .replace(/\{\{\s*entry_time\s*\}\}/gi, entryTime)
      .replace(/\{\{\s*check_in_time\s*\}\}/gi, checkInTime);
  }

  if (!(trigger === "morning_welcome" && isEffectiveDayPassGuest(guest as GuestRoomFields))) {
    body = applySaturdayCheckInTimeOverride(body, arrivalYmd);
  }

  if (trigger === "pre_arrival_2d") {
    body = ensureArrivalConfirmationCta(body, { autoAppend: opts?.stage1AutoAppendCta !== false });
  }
  if (
    (trigger === "night_before_daypass" || trigger === "morning_welcome")
  ) {
    body = ensureDaypassWindowOpenerCta(body);
  }

  return body;
}

export type PipelineWhapiBulkSkip = { guestId: number; reason: string };

export async function enqueuePipelineGuestWhapiBulk(
  supabase: SupabaseClient,
  params: { guestIds: number[]; trigger: string; source: string },
): Promise<{
  batchId: string;
  queued: number;
  etaMinutes: number;
  skipped: PipelineWhapiBulkSkip[];
}> {
  const guestIds = [...new Set((params.guestIds ?? []).map((id) => Number(id)).filter((id) => id > 0))];
  if (guestIds.length === 0) throw new Error("whapi_bulk_no_guests: אין אורחים לתזמן.");

  const trigger = String(params.trigger ?? "").trim();
  if (!trigger) throw new Error("whapi_bulk_trigger_required: חסר trigger.");

  const { data: stageRow } = await supabase
    .from("automation_stages")
    .select("session_message_script_key, session_message_script_key_shabbat")
    .eq("stage_key", trigger)
    .maybeSingle();

  const { data: guests } = await supabase
    .from("guests")
    .select("id, name, phone, portal_token, arrival_date, spa_time, room_type, room, status")
    .in("id", guestIds);

  const guestById = new Map<number, Record<string, unknown>>();
  for (const g of (guests ?? []) as Record<string, unknown>[]) {
    guestById.set(Number(g.id), g);
  }

  const stage1AutoAppendCta = trigger === "pre_arrival_2d"
    ? await loadStage1AutoAppendCta(supabase)
    : true;
  const nightBeforeCfg = (trigger === "night_before" || trigger === "night_before_daypass")
    ? await fetchNightBeforeKnowledge(supabase)
    : undefined;

  const skipped: PipelineWhapiBulkSkip[] = [];
  const recipients: WhapiBulkRecipient[] = [];

  for (const guestId of guestIds) {
    const guest = guestById.get(guestId);
    if (!guest) {
      skipped.push({ guestId, reason: "guest_not_found" });
      continue;
    }
    const phone = normalizeOritGuestPhoneDigits(guest.phone);
    if (!phone) {
      skipped.push({ guestId, reason: "missing_phone" });
      continue;
    }
    const body = await buildPipelineWhapiSessionBody(supabase, guest, trigger, stageRow, {
      stage1AutoAppendCta,
      nightBeforeCfg,
    });
    if (!body) {
      skipped.push({ guestId, reason: "whapi_session_unavailable" });
      continue;
    }
    recipients.push({
      phone,
      name: String(guest.name ?? "").trim() || null,
      messageTemplate: body,
      guestId,
    });
  }

  if (recipients.length === 0) {
    throw new Error("whapi_bulk_no_valid_recipients: אף אורח לא נכנס לתור — בדקו טלפון ו-Bot Script.");
  }

  const { batchId, queued, etaMinutes } = await enqueueWhapiBulkJob(supabase, {
    recipients,
    messageTemplate: recipients[0].messageTemplate ?? "",
    trigger,
    source: params.source,
  });

  return { batchId, queued, etaMinutes, skipped };
}
