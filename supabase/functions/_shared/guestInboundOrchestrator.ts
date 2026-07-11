// supabase/functions/_shared/guestInboundOrchestrator.ts
//
// Shared Tier-0 pipeline pieces for guest-inbound handling, extracted from
// whatsapp-webhook/index.ts (Meta) so whapi-webhook (Suites device) can reach
// the same P0 business logic instead of re-implementing it: Stage 2 arrival
// confirmation ("כן מגיעים"), record-only arrival-TIME capture, and the
// {{PLACEHOLDER}} resolver both stages use for message bodies.
//
// Design: the channel-specific bits (how a message is actually sent, how the
// staff-claim mute suspension works, how outbound gets logged) are NOT moved
// here — they stay in each webhook file and are passed in as a small adapter.
// Everything else (duplicate checks, eligibility checks, DB writes, script
// resolution) lives once, here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkPipelineDuplicate,
  logDuplicateBlocked,
} from "./automationDuplicateGuard.ts";
import { assertGuestEligibleForAutomation } from "./guestOutboundGuard.ts";
import { formatWhapiSuitesConversationLog } from "./outboundDispatchTag.ts";
import { shouldRouteGuestOutboundViaWhapiSuites } from "./guestWhapiRouting.ts";
import { extractArrivalTimeFromText } from "./guestEta.ts";
import {
  buildSpaLine,
  buildOptionalSpaText,
  hasSpaBooking,
  buildSpaTimeSentence,
  normalizeHmTime,
  normalizeSpaDateYmd,
} from "./spaSchedule.ts";

const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes — same convention as every other cache in this repo.

// ── automation_stages lookup (moved from whatsapp-webhook/index.ts) ─────────
export interface AutomationStageRow {
  is_active: boolean;
  session_message_script_key: string | null;
  interactive_buttons: Array<{ type: string; label: string; url?: string }> | null;
  offset_hours?: number | null;
}
const _stageCache = new Map<string, { row: AutomationStageRow | null; time: number }>();

export async function fetchAutomationStage(
  supabaseClient: ReturnType<typeof createClient>,
  stageKey: string,
): Promise<AutomationStageRow | null> {
  const now = Date.now();
  const cached = _stageCache.get(stageKey);
  if (cached && now - cached.time < CONFIG_TTL_MS) return cached.row;
  try {
    const { data } = await supabaseClient
      .from("automation_stages")
      .select("is_active, session_message_script_key, interactive_buttons, offset_hours")
      .eq("stage_key", stageKey)
      .maybeSingle();
    const row = (data as AutomationStageRow | null) ?? null;
    _stageCache.set(stageKey, { row, time: now });
    return row;
  } catch (e) {
    console.warn(`[guestInboundOrchestrator] fetchAutomationStage(${stageKey}) error:`, (e as Error).message);
    return cached?.row ?? null;
  }
}

// ── Spa vars + {{PLACEHOLDER}} resolver (moved from whatsapp-webhook/index.ts) ──
export function spaVarsFromGuest(guest: Record<string, unknown> | null): {
  spaTime: string | null;
  spaDate: string | null;
} {
  const spaTime = normalizeHmTime(guest?.spa_time) || null;
  const spaDate = normalizeSpaDateYmd(guest?.spa_date) || null;
  return { spaTime, spaDate };
}

export function resolvePlaceholders(
  template: string,
  vars: {
    guestName: string;
    spaTime: string | null;
    spaDate?: string | null;
    workshopUrl: string;
    portalLink?: string;
  },
): string {
  const spaDate = vars.spaDate ?? null;
  const spaTime = vars.spaTime;
  const spaLine = buildSpaLine(spaDate, spaTime);
  const optionalSpaText = buildOptionalSpaText(spaDate, spaTime);

  let text = template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, vars.workshopUrl)
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, spaLine)
    .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, optionalSpaText);

  // {{PORTAL_LINK}}: substitute the real link, or strip the containing sentence
  // entirely if the guest has no portal_token — never leave a blank "click
  // here: " dangling in the message (Graceful Fallback). {{portal_url}} is an
  // alias for the exact same value — supporting both spellings means neither
  // an already-saved script nor a newly-typed one breaks.
  const PORTAL_PLACEHOLDER_RE = /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi;
  if (vars.portalLink) {
    text = text.replace(PORTAL_PLACEHOLDER_RE, vars.portalLink);
  } else {
    if (PORTAL_PLACEHOLDER_RE.test(text)) {
      console.warn("[guestInboundOrchestrator] resolvePlaceholders() — guest has no portal_token; stripped portal-link sentence rather than send a blank link.");
    }
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  if (hasSpaBooking(spaDate, spaTime)) {
    const spaSentence = buildSpaTimeSentence(spaDate, spaTime).replace(/\.$/, "");
    text = text.replace(/\{\{\s*SPA_TIME\s*\}\}/gi, spaSentence);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*SPA_TIME\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  const hadSpaPlaceholder = /\{\{\s*(?:SPA_LINE|OPTIONAL_SPA_TEXT|SPA_TIME)\s*\}\}/i.test(template);
  if (hasSpaBooking(spaDate, spaTime) && !hadSpaPlaceholder) {
    console.warn(
      `[guestInboundOrchestrator] resolvePlaceholders() force-injecting spa sentence — template had no ` +
      `recognized spa placeholder spaDate="${spaDate}" spaTime="${spaTime}"`,
    );
    text = `${text.trim()}\n\n${buildSpaTimeSentence(spaDate, spaTime)}`;
  }

  return text.trim();
}

// ── Portal link + arrival-confirm eligibility (moved from whatsapp-webhook/index.ts) ──
const PORTAL_BASE_URL = (Deno.env.get("PORTAL_BASE_URL") ?? "https://dream-ai-system.vercel.app").replace(/\/$/, "");
export function buildPortalLink(portalToken: unknown): string {
  const token = String(portalToken ?? "").trim();
  return token ? `${PORTAL_BASE_URL}/portal/${token}` : "";
}

export function canGuestConfirmArrival(guest: Record<string, unknown> | null): boolean {
  if (!guest) return true;
  if (String(guest.status ?? "") === "cancelled") return false;
  // Allow catch-up when confirm landed but Stage 2 never delivered (staff-claim / send failure).
  if (guest.arrival_confirmed === true && guest.msg_stage_2_arrival_sent === true) return false;
  return true;
}

// ── Record-only arrival-TIME capture (moved from whatsapp-webhook/index.ts) ──
export const RECORD_ONLY_ARRIVAL_REPLY =
  "תודה שעדכנתם, רשמתי לפניי את שעת ההגעה שלכם. מחכים לכם!";

/** Date-change, cancellation, or booking issue → escalate to human staff, never AI */
export const DATE_CHANGE_RE =
  /שינוי\s*(ב)?תארי[כך]|שינוי\s*הזמנ|לשנות\s*(את\s*)?(ה)?תארי[כך]|לבטל|ביטול|לא\s*נוכל??\s*להגיע|לא\s*יכול(ים|ה)?\s*להגיע|לא\s*מגיעים|דחיי?ה|להדחות|בעיה\s*עם\s*(ה)?הזמנ/i;

/** Guest asking when to arrive — FAQ, not a time update. */
const ARRIVAL_TIME_QUESTION_RE =
  /(?:מה|איזו|מתי|באיזה|כמה)\s+.{0,24}?(?:שעת?\s*ה?געה|נגיע|מגיע)|\?\s*$|what\s+time\s+(do|should|can)/i;

/** Guest stating an estimated arrival time (not a date-change request). */
const ARRIVAL_TIME_UPDATE_RE =
  /שעת\s*הגעה|נגיע|ניגיע|מגיעים?|מתכנ(?:ן|נת|נים|נות)\s*להגיע|להגיע\s+(?:לקראת|בסביבות|בערך|ב[-–]?\s*\d)|הגעה\s|צפו[ייה]\s*להגיע|מתוכנן|לקראת|בסביבות|בערך|arriving\s+at|planning\s+to\s+arrive|around\s+\d/i;

export function isRecordOnlyArrivalTimeUpdate(text: string): boolean {
  if (DATE_CHANGE_RE.test(text)) return false;
  if (ARRIVAL_TIME_QUESTION_RE.test(text)) return false;
  const time = extractArrivalTimeFromText(text);
  if (!time) return false;
  const trimmed = text.trim();
  const isBareTimeReply =
    trimmed.length <= 8 &&
    !/[א-ת]{4,}/.test(trimmed.replace(/[\d:.׳·\s-–]/g, ""));
  return ARRIVAL_TIME_UPDATE_RE.test(text) || isBareTimeReply;
}

// ── whatsapp_conversations patch helper (moved from whatsapp-webhook/index.ts) ──
export async function patchClaimedInbound(
  supabase: ReturnType<typeof createClient>,
  conversationId: number | null,
  waMessageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const q = conversationId
    ? supabase.from("whatsapp_conversations").update(patch).eq("id", conversationId)
    : supabase.from("whatsapp_conversations").update(patch).eq("wa_message_id", waMessageId);
  const { error } = await q;
  if (error) console.warn("[guestInboundOrchestrator] patchClaimedInbound failed:", error.message);
}

// ── whatsapp-send pipeline fallback (moved from whatsapp-webhook/index.ts) ──
// NOTE: whatsapp-send's own stage_2_arrival "pipeline_reconcile" branch is
// Meta-only today (§3 of this rollout fixes that) — this fallback is a rare
// last-resort safety net (direct send failed), not the primary path, for
// either channel.
export async function dispatchStage2ViaPipeline(
  guestId: number,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trigger: "stage_2_arrival", guestId, pipeline_reconcile: true }),
      signal: AbortSignal.timeout(28000),
    });
    const data = await res.json() as Record<string, unknown>;
    return {
      ok: data.ok === true,
      status: data.status ? String(data.status) : undefined,
      error: data.error ? String(data.error) : undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Per-channel staff claim (migration 171, §4) ─────────────────────────────
// guests.claimed_by only ever means the Meta claim (unchanged, read directly
// by every existing caller) — this is the lookup for every OTHER channel
// (today: Whapi only). Returns null when nothing is claimed on that channel.
export async function fetchChannelClaim(
  supabaseClient: { from: (t: string) => unknown },
  guestId: number | string | null,
  channel: "meta" | "whapi",
): Promise<string | null> {
  if (guestId == null || guestId === "") return null;
  const id = Number(guestId);
  if (!Number.isFinite(id)) return null;
  const supabase = supabaseClient as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            maybeSingle: () => Promise<{ data: { claimed_by: string | null } | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
  const { data, error } = await supabase
    .from("guest_channel_claims")
    .select("claimed_by")
    .eq("guest_id", id)
    .eq("inbox_channel", channel)
    .maybeSingle();
  if (error) {
    console.warn("[guestInboundOrchestrator] fetchChannelClaim failed:", error.message);
    return null;
  }
  return data?.claimed_by ?? null;
}

// ── bot_active, per channel ───────────────────────────────────────────────
// §4 (per-channel toggle UI) hasn't landed yet — this reads the bot_config
// stub seeded by migration 170 so the Whapi Stage2/ETA work in §2 doesn't
// have to wait for it. Default true (bot on), same convention as bot_active.
export function isWhapiBotActive(botConfig: Record<string, string>): boolean {
  return botConfig["bot_active_whapi"] !== "false";
}

// ── Stage 2 arrival confirmation — core orchestration ───────────────────────
export type ArrivalConfirmationCtx = {
  stage2ScriptText: string | null; // bot_scripts.stage_2_arrival.message_text
  phone: string;
  guestId: number | null;
  guest: Record<string, unknown> | null;
  sim: boolean;
  source: "button" | "text" | "burst";
  buttonTitle?: string;
  claimedConversationId?: number | null;
  msgId?: string;
  channel: "meta" | "whapi"; // channel THIS inbound message arrived on
};

export type GuestOutboundRow = {
  phone: string;
  guest_id: number | null;
  message: string;
  wa_message_id: string | null;
  intent: string;
  channel?: "meta" | "whapi";
};

export type ArrivalConfirmationAdapter = {
  /** Actually transmit the message; useWhapi decided internally (dispatch_channel + inbound channel). */
  sendMessage: (phone: string, body: string, useWhapi: boolean) => Promise<string>;
  insertOutboundIfNotMuted: (row: GuestOutboundRow) => Promise<boolean>;
  dispatchFallbackPipeline: (guestId: number) => Promise<{ ok: boolean; status?: string; error?: string }>;
  /** Meta needs to suspend its staff-claim-mute flag for this one send (Stage 2
   *  must never be blocked by a staff claim); Whapi has no such flag today, so
   *  its adapter can just run fn() directly. */
  withStaffMuteSuspended: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Stage 2 arrival-confirmation core logic — duplicate/eligibility checks,
 * guest row update, script resolution, notification_log — channel-agnostic.
 * Returns { proceeded: false } for every early-exit guard (already
 * processed/ineligible) so the caller knows whether to run any of its own
 * follow-up steps (e.g. whatsapp-webhook's Stage 2 Pay follow-up).
 */
export async function runGuestArrivalConfirmation(
  supabaseClient: ReturnType<typeof createClient>,
  ctx: ArrivalConfirmationCtx,
  adapter: ArrivalConfirmationAdapter,
): Promise<{ proceeded: boolean }> {
  const {
    stage2ScriptText, phone, guestId, guest, sim, source, buttonTitle,
    claimedConversationId, msgId, channel,
  } = ctx;

  if (!canGuestConfirmArrival(guest)) {
    if (guestId && !sim) {
      const dup = await checkPipelineDuplicate(supabaseClient, { guestId, triggerType: "stage_2_arrival" });
      if (dup.blocked) {
        await logDuplicateBlocked(supabaseClient, {
          guestId, recipient: phone, triggerType: "stage_2_arrival",
          reason: dup.reason, priorSentAt: dup.priorSentAt,
          source: `webhook_confirm_repeat_${source}`,
        });
      }
    }
    console.info(
      `[guestInboundOrchestrator] arrival confirm skipped — pipeline already complete phone:${phone} status:${guest?.status ?? "null"}`,
    );
    return { proceeded: false };
  }

  if (guest?.arrival_confirmed === true && guest?.msg_stage_2_arrival_sent === true) {
    console.info(`[guestInboundOrchestrator] arrival pipeline complete — skip duplicate confirm phone:${phone}`);
    return { proceeded: false };
  }

  if (guestId) {
    const confirmedAt = new Date().toISOString();
    const windowExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { error: confirmErr } = await supabaseClient.from("guests").update({
      arrival_confirmed: true,
      arrival_confirmed_at: confirmedAt,
      wa_window_expires_at: windowExpires,
      ...(guest?.status === "pending" ? { status: "expected" } : {}),
    }).eq("id", guestId);
    if (confirmErr) {
      console.error(`[guestInboundOrchestrator] arrival_confirmed update FAILED phone:${phone}:`, confirmErr.message);
    } else if (guest) {
      guest.arrival_confirmed = true;
      guest.arrival_confirmed_at = confirmedAt;
      guest.wa_window_expires_at = windowExpires;
    }
  } else {
    console.warn(
      `[guestInboundOrchestrator] ⚠️ arrival confirm (${source}) but NO guest record for phone:${phone} — add guest for status/spa sync.`,
    );
  }

  if (claimedConversationId != null || msgId) {
    await patchClaimedInbound(supabaseClient, claimedConversationId ?? null, msgId ?? "", {
      guest_id: guestId,
      intent: source === "button" ? "button_reply" : "confirmation",
    });
  }

  const stage2Inactive = assertGuestEligibleForAutomation(guest as { status?: string | null } | null);
  if (!guestId || stage2Inactive) {
    console.warn(
      `[guestInboundOrchestrator] stage_2_arrival outbound blocked phone:${phone} reason:${stage2Inactive ?? "guest_not_found"}`,
    );
    return { proceeded: false };
  }

  const stage2Arrival = await fetchAutomationStage(supabaseClient, "stage_2_arrival");

  if (stage2Arrival?.is_active === false) {
    console.info(`[guestInboundOrchestrator] stage_2_arrival paused in automation_stages — confirm saved, no arrival reply phone:${phone}`);
    return { proceeded: true };
  }

  // Interactive «כן מגיעים» always fires Stage 2 immediately — offset_hours is
  // for cron/ACC catch-up only (guests who confirmed but never got the message).
  const deferHours = stage2Arrival?.offset_hours ?? 0;
  if (deferHours > 0) {
    console.info(
      `[guestInboundOrchestrator] stage_2_arrival offset_hours=${deferHours} ignored on live confirm — sending now phone:${phone}`,
    );
  }

  const safeName = String(guest?.name ?? "").trim() || "אורח יקר";
  const { spaTime, spaDate } = spaVarsFromGuest(guest);
  const portalLink = buildPortalLink(guest?.portal_token);
  if (!portalLink) {
    console.warn(
      `[guestInboundOrchestrator] ⚠️ guest ${phone} (id:${guestId}) has no portal_token — Stage 2 reply will not include a portal link.`,
    );
  }

  if (!stage2ScriptText?.trim()) {
    console.error(
      `[guestInboundOrchestrator] stage_2_arrival: bot_scripts.message_text missing/empty — ` +
      `refusing invented fallback phone:${phone} (edit in BotScriptEditor)`,
    );
    return { proceeded: true };
  }

  const arrivalReply = resolvePlaceholders(stage2ScriptText, {
    guestName: safeName, spaTime, spaDate, workshopUrl: "", portalLink,
  });

  console.info(`[guestInboundOrchestrator] 🎉 arrival confirmed (${source}) — phone:${phone} name="${safeName}"`);

  if (sim) {
    console.info(`[guestInboundOrchestrator] SIM — would send Stage 2 arrival reply to ${phone}`);
    return { proceeded: true };
  }

  const outboundIntent = source === "button" ? "arrival_confirmed" : "confirmation";

  // All autonomous suite-guest automation routes through Whapi when the
  // feature flag is on (owner decision, 2026-07-10) — no dispatch_channel
  // gate. OR'd with the inbound message itself having arrived via Whapi (a
  // guest replying on that thread should get the reply on the SAME thread —
  // conversational locality — even for a guest not otherwise Whapi-eligible).
  const useWhapiForStage2 =
    channel === "whapi" ||
    shouldRouteGuestOutboundViaWhapiSuites(guest as { room?: unknown; room_type?: unknown } | null);

  if (guestId) {
    const dup = await checkPipelineDuplicate(supabaseClient, { guestId, triggerType: "stage_2_arrival" });
    if (dup.blocked) {
      await logDuplicateBlocked(supabaseClient, {
        guestId, recipient: phone, triggerType: "stage_2_arrival",
        reason: dup.reason, priorSentAt: dup.priorSentAt,
        source: `webhook_stage2_${source}`,
      });
      console.info(`[guestInboundOrchestrator] stage_2 duplicate_blocked on live ${source} phone:${phone}`);
      return { proceeded: true };
    }
  }

  let sentOk = false;
  await adapter.withStaffMuteSuspended(async () => {
    try {
      const waId = await adapter.sendMessage(phone, arrivalReply, useWhapiForStage2);
      if (!waId) {
        console.warn(
          `[guestInboundOrchestrator] ⚠️ stage_2_arrival send empty — phone:${phone} channel:${useWhapiForStage2 ? "whapi" : "meta"} (will try pipeline fallback)`,
        );
        return;
      }
      const convLogged = await adapter.insertOutboundIfNotMuted({
        phone, guest_id: guestId,
        message: useWhapiForStage2 ? formatWhapiSuitesConversationLog(arrivalReply) : arrivalReply,
        wa_message_id: waId === "unknown" ? null : waId,
        intent: outboundIntent,
        channel: useWhapiForStage2 ? "whapi" : "meta",
      });
      if (!convLogged) {
        console.error(
          `[guestInboundOrchestrator] ⚠️ stage_2_arrival ${useWhapiForStage2 ? "Whapi" : "Meta"} send OK but inbox log FAILED — phone:${phone} intent:${outboundIntent}`,
        );
      }
      if (guestId) {
        await supabaseClient.from("guests").update({ msg_stage_2_arrival_sent: true }).eq("id", guestId);
        try {
          const { error: logErr } = await supabaseClient.from("notification_log").insert({
            guest_id: guestId, recipient: phone,
            trigger_type: "stage_2_arrival", channel: "whatsapp",
            status: "sent",
            payload: {
              source,
              channel: useWhapiForStage2 ? "whapi_session" : "meta_session",
              ...(buttonTitle ? { buttonTitle } : {}),
            },
          });
          if (logErr) console.warn("[guestInboundOrchestrator] notification_log stage_2_arrival:", logErr.message);
        } catch (logEx) {
          console.warn("[guestInboundOrchestrator] notification_log stage_2_arrival:", (logEx as Error).message);
        }
      }
      console.info(`[guestInboundOrchestrator] ✅ arrival reply sent to ${phone} via ${useWhapiForStage2 ? "Whapi" : "Meta"}`);
      sentOk = true;
    } catch (e) {
      const errMsg = (e as Error).message;
      const replyStatus = errMsg.startsWith("timeout_no_response") ? "timeout" : "failed";
      console.error(`[guestInboundOrchestrator] ❌ arrival reply ${replyStatus} to ${phone}:`, errMsg);
      try {
        const { error: logErr } = await supabaseClient.from("notification_log").insert({
          guest_id: guestId, recipient: phone,
          trigger_type: "stage_2_arrival", channel: "whatsapp",
          status: replyStatus,
          payload: {
            error: errMsg, source,
            channel: useWhapiForStage2 ? "whapi_session" : "meta_session",
            ...(buttonTitle ? { buttonTitle } : {}),
          },
        });
        if (logErr) console.warn("[guestInboundOrchestrator] notification_log insert error:", logErr.message);
      } catch (logEx) {
        console.warn("[guestInboundOrchestrator] notification_log insert error:", (logEx as Error).message);
      }
    }
  });

  if (!sentOk && guestId) {
    console.warn(`[guestInboundOrchestrator] stage_2 webhook path missed — invoking whatsapp-send pipeline guest_id=${guestId}`);
    const fallback = await adapter.dispatchFallbackPipeline(guestId);
    if (fallback.ok) {
      console.info(`[guestInboundOrchestrator] ✅ stage_2 pipeline fallback ok guest_id=${guestId} status:${fallback.status}`);
    } else {
      console.error(`[guestInboundOrchestrator] ❌ stage_2 pipeline fallback failed guest_id=${guestId}:`, fallback.error);
    }
  }

  return { proceeded: true };
}
