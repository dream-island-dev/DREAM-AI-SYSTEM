// supabase/functions/_shared/whapiVelocityGuard.ts
//
// Server-enforced anti-ban velocity guard for the Suites Whapi device — a
// real ~24h device restriction happened on 2026-07-23 from a cold bulk send
// to ~40 waiters (WaiterPulseDispatchPanel, 2.5s client-side gap — not
// sufficient on its own; see docs/xos_agent_playbook.md §10).
//
// Three classes of send (caller decides `sendClass` — this module never
// guesses from content):
//   "group" — `to` ends with "@g.us" (also auto-detected). Fully exempt —
//             WhatsApp's bulk/spam detection targets 1:1 DM patterns, not
//             posting into a group the device is already a member of.
//   "staff" — 1:1 DM to a known team member (digests, task alerts, Sigal
//             chat). Exempt from the per-recipient hot/warm/cold caps
//             (legitimately high-frequency), but still serialized behind
//             global_min_gap_sec like every other non-group send.
//   "guest" — full per-recipient classification (hot/warm/cold) + caps.
//
// `sendWhapiTextGuarded`/`sendWhapiImageGuarded` are the call sites' actual
// entry point — they wrap _shared/whapiSend.ts's sendWhapiText/sendWhapiImage
// with an assert-then-record cycle so every wired caller gets identical
// behavior without duplicating the check.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import { sendWhapiText, sendWhapiImage, cleanPhoneForMention } from "./whapiSend.ts";
import { phoneLookupVariants, isGuestActiveForOutbound } from "./guestOutboundGuard.ts";

export type WhapiSendClass = "guest" | "staff" | "group";
export type WhapiRiskTier = "hot" | "warm" | "cold" | "staff" | "group";

type TierLimits = { gap_sec: number; per_hour: number; per_day: number };

export type WhapiVelocityLimits = {
  global_min_gap_sec: number;
  jitter_min_sec: number;
  jitter_max_sec: number;
  hot: TierLimits;
  warm: TierLimits;
  cold: TierLimits;
  bulk_max_recipients_per_job: number;
  bulk_requires_queue: boolean;
  post_ban_cooldown_hours: number;
  cold_blocked_during_cooldown: boolean;
};

// Mirrors the bot_config seed in migration 274 — used whenever the row is
// missing/unparseable so a config outage degrades to the same conservative
// numbers rather than silently disabling the guard.
export const DEFAULT_WHAPI_VELOCITY_LIMITS: WhapiVelocityLimits = {
  global_min_gap_sec: 10,
  jitter_min_sec: 8,
  jitter_max_sec: 15,
  hot: { gap_sec: 5, per_hour: 40, per_day: 400 },
  warm: { gap_sec: 10, per_hour: 25, per_day: 120 },
  cold: { gap_sec: 45, per_hour: 5, per_day: 10 },
  bulk_max_recipients_per_job: 60,
  bulk_requires_queue: true,
  post_ban_cooldown_hours: 48,
  cold_blocked_during_cooldown: true,
};

export type WhapiVelocityState = {
  last_ban_at: string | null;
  cooldown_until: string | null;
  note?: string;
};

const EMPTY_STATE: WhapiVelocityState = { last_ban_at: null, cooldown_until: null };

let _limitsCache: WhapiVelocityLimits | null = null;
let _limitsCacheAt = 0;
const LIMITS_TTL_MS = 60_000;

/** Test-only — force the next loadWhapiVelocityLimits() call to re-fetch. */
export function __resetWhapiVelocityLimitsCacheForTest(): void {
  _limitsCache = null;
  _limitsCacheAt = 0;
}

export async function loadWhapiVelocityLimits(supabase: SupabaseClient): Promise<WhapiVelocityLimits> {
  const now = Date.now();
  if (_limitsCache && now - _limitsCacheAt < LIMITS_TTL_MS) return _limitsCache;
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", "whapi_velocity_limits")
    .maybeSingle();
  let parsed: Partial<WhapiVelocityLimits> = {};
  try {
    parsed = data?.config_value ? JSON.parse(data.config_value) : {};
  } catch {
    parsed = {};
  }
  const merged: WhapiVelocityLimits = {
    ...DEFAULT_WHAPI_VELOCITY_LIMITS,
    ...parsed,
    hot: { ...DEFAULT_WHAPI_VELOCITY_LIMITS.hot, ...parsed.hot },
    warm: { ...DEFAULT_WHAPI_VELOCITY_LIMITS.warm, ...parsed.warm },
    cold: { ...DEFAULT_WHAPI_VELOCITY_LIMITS.cold, ...parsed.cold },
  };
  _limitsCache = merged;
  _limitsCacheAt = now;
  return merged;
}

export async function loadWhapiVelocityState(supabase: SupabaseClient): Promise<WhapiVelocityState> {
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", "whapi_velocity_state")
    .maybeSingle();
  try {
    return data?.config_value ? { ...EMPTY_STATE, ...JSON.parse(data.config_value) } : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function isPostBanCooldownActive(state: WhapiVelocityState, now: Date = new Date()): boolean {
  if (!state.cooldown_until) return false;
  const until = new Date(state.cooldown_until).getTime();
  return !Number.isNaN(until) && now.getTime() < until;
}

export function isWhapiGroupId(to: string): boolean {
  return String(to ?? "").trim().endsWith("@g.us");
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * hot  — this phone messaged the Suites Whapi number in the last 14 days.
 * warm — active `guests` row (not cancelled/checked_out), OR inbound on the
 *        Meta channel in the last 30 days (guest is known to the resort even
 *        if they've never used this specific device before).
 * cold — everything else: unknown numbers, waiters/vendors with no inbound
 *        history, first contact.
 */
export async function classifyWhapiRisk(
  supabase: SupabaseClient,
  phone: string,
  now: Date = new Date(),
): Promise<"hot" | "warm" | "cold"> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return "cold";

  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600_000).toISOString();
  const { data: inboundWhapi } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .in("phone", variants)
    .eq("inbox_channel", "whapi")
    .eq("direction", "inbound")
    .gte("created_at", fourteenDaysAgo)
    .limit(1)
    .maybeSingle();
  if (inboundWhapi) return "hot";

  const { data: guestRow } = await supabase
    .from("guests")
    .select("status")
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  if (guestRow && isGuestActiveForOutbound(guestRow)) return "warm";

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  const { data: inboundMeta } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .in("phone", variants)
    .eq("inbox_channel", "meta")
    .eq("direction", "inbound")
    .gte("created_at", thirtyDaysAgo)
    .limit(1)
    .maybeSingle();
  if (inboundMeta) return "warm";

  return "cold";
}

export type WhapiVelocityContext = {
  /** Exact `to` the send will use — group id, bare-digits phone, or E.164. */
  phone: string;
  body: string;
  sendClass: WhapiSendClass;
  trigger?: string;
  source?: string;
};

export type WhapiVelocityDecision =
  | { allowed: true; riskTier: WhapiRiskTier }
  | { allowed: false; riskTier: WhapiRiskTier; reasonHe: string; retryAfterSec: number };

/** Normalized ledger key — bare digits for phones, untouched for group ids. */
function ledgerPhoneKey(to: string): string {
  return isWhapiGroupId(to) ? to : cleanPhoneForMention(to);
}

export async function assertWhapiVelocityAllowed(
  supabase: SupabaseClient,
  ctx: WhapiVelocityContext,
  now: Date = new Date(),
): Promise<WhapiVelocityDecision> {
  if (ctx.sendClass === "group" || isWhapiGroupId(ctx.phone)) {
    return { allowed: true, riskTier: "group" };
  }

  const limits = await loadWhapiVelocityLimits(supabase);
  const ledgerPhone = ledgerPhoneKey(ctx.phone);

  // Global minimum gap — every non-group send, staff or guest, is serialized
  // behind this so two unrelated call sites firing near-simultaneously
  // (e.g. a digest cron alongside a guest dispatch) never look like a burst
  // to WhatsApp even though the recipients differ.
  const { data: lastAny } = await supabase
    .from("whapi_send_ledger")
    .select("sent_at")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastAny?.sent_at) {
    const elapsedSec = (now.getTime() - new Date(lastAny.sent_at).getTime()) / 1000;
    if (elapsedSec < limits.global_min_gap_sec) {
      const retryAfterSec = Math.ceil(limits.global_min_gap_sec - elapsedSec);
      return {
        allowed: false,
        riskTier: ctx.sendClass === "staff" ? "staff" : "cold",
        reasonHe: `קצב שליחה גלובלי ל-Whapi — יש להמתין ${retryAfterSec} שניות נוספות.`,
        retryAfterSec,
      };
    }
  }

  if (ctx.sendClass === "staff") {
    return { allowed: true, riskTier: "staff" };
  }

  const state = await loadWhapiVelocityState(supabase);
  const cooldownActive = isPostBanCooldownActive(state, now);

  const riskTier = await classifyWhapiRisk(supabase, ledgerPhone, now);

  if (cooldownActive && limits.cold_blocked_during_cooldown && riskTier === "cold") {
    return {
      allowed: false,
      riskTier,
      reasonHe: "🚨 מצב Cooldown אחרי באן פעיל — שליחה ל'קר' חסומה עד שהמכשיר יאושר תקין (whapi_velocity_state.cooldown_until).",
      retryAfterSec: 3600,
    };
  }

  const tierLimits = limits[riskTier];
  const capDivisor = cooldownActive ? 2 : 1;
  const perHourCap = Math.max(1, Math.floor(tierLimits.per_hour / capDivisor));
  const perDayCap = Math.max(1, Math.floor(tierLimits.per_day / capDivisor));

  const oneDayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const { data: recentRows } = await supabase
    .from("whapi_send_ledger")
    .select("sent_at")
    .eq("phone", ledgerPhone)
    .gte("sent_at", oneDayAgo)
    .order("sent_at", { ascending: false });
  const rows: Array<{ sent_at: string }> = recentRows ?? [];

  if (rows[0]?.sent_at) {
    const elapsedSec = (now.getTime() - new Date(rows[0].sent_at).getTime()) / 1000;
    if (elapsedSec < tierLimits.gap_sec) {
      const retryAfterSec = Math.ceil(tierLimits.gap_sec - elapsedSec);
      return {
        allowed: false,
        riskTier,
        reasonHe: `מכסת קצב (${riskTier}) לנמען זה — יש להמתין ${retryAfterSec} שניות.`,
        retryAfterSec,
      };
    }
  }

  const oneHourAgoMs = now.getTime() - 3_600_000;
  const countLastHour = rows.filter((r) => new Date(r.sent_at).getTime() >= oneHourAgoMs).length;
  if (countLastHour >= perHourCap) {
    return {
      allowed: false,
      riskTier,
      reasonHe: `מכסת שעה (${riskTier}) לנמען זה הגיעה לתקרה (${perHourCap}).`,
      retryAfterSec: 3600,
    };
  }
  if (rows.length >= perDayCap) {
    return {
      allowed: false,
      riskTier,
      reasonHe: `מכסת יום (${riskTier}) לנמען זה הגיעה לתקרה (${perDayCap}).`,
      retryAfterSec: 3600,
    };
  }

  return { allowed: true, riskTier };
}

export async function recordWhapiSend(
  supabase: SupabaseClient,
  params: { phone: string; riskTier: WhapiRiskTier; trigger?: string; source?: string; body?: string },
): Promise<void> {
  const bodyHash = params.body ? await sha256Hex(params.body) : null;
  const { error } = await supabase.from("whapi_send_ledger").insert({
    phone: ledgerPhoneKey(params.phone),
    risk_tier: params.riskTier,
    trigger: params.trigger ?? null,
    source: params.source ?? null,
    body_hash: bodyHash,
  });
  if (error) {
    console.warn("[whapiVelocityGuard] recordWhapiSend failed (non-blocking):", error.message);
  }
}

/** Parseable by callers: `whapi_rate_limited: <Hebrew reason>|retry_after_sec=<n>`. */
export class WhapiRateLimitedError extends Error {
  retryAfterSec: number;
  riskTier: WhapiRiskTier;
  constructor(reasonHe: string, retryAfterSec: number, riskTier: WhapiRiskTier) {
    super(`whapi_rate_limited: ${reasonHe}|retry_after_sec=${retryAfterSec}`);
    this.name = "WhapiRateLimitedError";
    this.retryAfterSec = retryAfterSec;
    this.riskTier = riskTier;
  }
}

export type WhapiGuardedSendOpts = {
  sendClass: WhapiSendClass;
  trigger?: string;
  source?: string;
  noLinkPreview?: boolean;
  mentions?: string[];
  tokenEnvVar?: string;
};

/** Guarded drop-in for _shared/whapiSend.ts's sendWhapiText — assert, send, record. */
export async function sendWhapiTextGuarded(
  supabase: SupabaseClient,
  to: string,
  body: string,
  opts: WhapiGuardedSendOpts,
): Promise<string | null> {
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: to,
    body,
    sendClass: opts.sendClass,
    trigger: opts.trigger,
    source: opts.source,
  });
  if (!decision.allowed) {
    throw new WhapiRateLimitedError(decision.reasonHe, decision.retryAfterSec, decision.riskTier);
  }
  const wamid = await sendWhapiText(to, body, {
    noLinkPreview: opts.noLinkPreview,
    mentions: opts.mentions,
    tokenEnvVar: opts.tokenEnvVar,
  });
  await recordWhapiSend(supabase, { phone: to, riskTier: decision.riskTier, trigger: opts.trigger, source: opts.source, body });
  return wamid;
}

/** Guarded drop-in for _shared/whapiSend.ts's sendWhapiImage. */
export async function sendWhapiImageGuarded(
  supabase: SupabaseClient,
  to: string,
  mediaUrl: string,
  caption: string | undefined,
  opts: { sendClass: WhapiSendClass; trigger?: string; source?: string; tokenEnvVar?: string },
): Promise<string | null> {
  const fingerprintBody = caption?.trim() || mediaUrl;
  const decision = await assertWhapiVelocityAllowed(supabase, {
    phone: to,
    body: fingerprintBody,
    sendClass: opts.sendClass,
    trigger: opts.trigger,
    source: opts.source,
  });
  if (!decision.allowed) {
    throw new WhapiRateLimitedError(decision.reasonHe, decision.retryAfterSec, decision.riskTier);
  }
  const wamid = await sendWhapiImage(to, mediaUrl, caption, { tokenEnvVar: opts.tokenEnvVar });
  await recordWhapiSend(supabase, { phone: to, riskTier: decision.riskTier, trigger: opts.trigger, source: opts.source, body: fingerprintBody });
  return wamid;
}
