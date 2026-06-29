// Shared Stage 2 Pay guardrails — used by whatsapp-webhook (auto) and
// whatsapp-send (manual payment_and_workshops). Never send a payment message
// without a validated direct payment URL.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const PAYMENT_LINK_FAILURE_LABEL = "שיגור נכשל: חסר קישור תשלום ישיר";
export const PAYMENT_LINK_FAILURE_CONTEXT = "Missing Payment Link";

const PAYMENT_URL_RE =
  /https?:\/\/(?:pay\.dream-island\.co\.il\/r\/[A-Za-z0-9_-]+|[^\s"'<>]+\/r\/[A-Za-z0-9_-]+)/i;

export function isWellFormedHttpUrl(raw: unknown): boolean {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Canonical direct link: direct_payment_url wins, payment_link_url is legacy alias. */
export function getDirectPaymentUrl(guest: Record<string, unknown>): string {
  const candidate = String(
    guest.direct_payment_url ?? guest.payment_link_url ?? "",
  ).trim();
  return isWellFormedHttpUrl(candidate) ? candidate : "";
}

export function getEzgoPortalUrl(guest: Record<string, unknown>): string {
  const candidate = String(guest.ezgo_portal_url ?? "").trim();
  return isWellFormedHttpUrl(candidate) ? candidate : "";
}

/** Meta dream_payment_and_workshops button suffix (…/r/{token}). */
export function extractPaymentUrlButtonToken(fullUrl: string): string {
  const trimmed = fullUrl.trim();
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export type PaymentLinkGuardOk = {
  ok: true;
  url: string;
  buttonToken: string;
};

export type PaymentLinkGuardFail = {
  ok: false;
  reason: "missing_link" | "invalid_url";
  recoveryQueued: boolean;
};

export type PaymentLinkGuardResult = PaymentLinkGuardOk | PaymentLinkGuardFail;

export async function queuePaymentLinkRecovery(
  supabase: SupabaseClient,
  guestId: string | number,
): Promise<void> {
  const { error } = await supabase
    .from("guests")
    .update({ payment_link_resolution_pending: true })
    .eq("id", guestId);
  if (error) {
    console.warn("[paymentLinkGuard] queue recovery flag failed:", error.message);
  }
}

/** Last-resort inline scrape — strict 3s AbortController cap. */
export async function tryInlinePaymentLinkRecovery(
  portalUrl: string,
  timeoutMs = 3000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(portalUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "DreamIsland-PaymentResolver/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(PAYMENT_URL_RE);
    const found = match?.[0]?.trim() ?? "";
    return isWellFormedHttpUrl(found) ? found : null;
  } catch (e) {
    const name = (e as Error).name;
    if (name === "AbortError") {
      console.warn("[paymentLinkGuard] inline recovery timed out after", timeoutMs, "ms");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function persistRecoveredPaymentUrl(
  supabase: SupabaseClient,
  guestId: string | number,
  url: string,
): Promise<void> {
  const { error } = await supabase
    .from("guests")
    .update({
      direct_payment_url: url,
      payment_link_url: url,
      payment_link_resolution_pending: false,
    })
    .eq("id", guestId);
  if (error) {
    console.warn("[paymentLinkGuard] persist recovered URL failed:", error.message);
  }
}

/**
 * Resolve a validated payment URL or queue async recovery.
 * When allowInlineRecovery=true, one 3s-capped fetch attempt runs before failing.
 */
export async function guardPaymentLink(
  supabase: SupabaseClient,
  guest: Record<string, unknown>,
  guestId: string | number | null,
  options?: { allowInlineRecovery?: boolean },
): Promise<PaymentLinkGuardResult> {
  let url = getDirectPaymentUrl(guest);
  if (url) {
    return { ok: true, url, buttonToken: extractPaymentUrlButtonToken(url) };
  }

  const hadInvalidCandidate = !!String(
    guest.direct_payment_url ?? guest.payment_link_url ?? "",
  ).trim();

  const ezgoPortal = getEzgoPortalUrl(guest);
  if (ezgoPortal && guestId != null) {
    console.warn("[Payment Link Resolution] Triggering link recovery fallback");
    await queuePaymentLinkRecovery(supabase, guestId);

    if (options?.allowInlineRecovery) {
      const recovered = await tryInlinePaymentLinkRecovery(ezgoPortal);
      if (recovered) {
        await persistRecoveredPaymentUrl(supabase, guestId, recovered);
        return {
          ok: true,
          url: recovered,
          buttonToken: extractPaymentUrlButtonToken(recovered),
        };
      }
    }
  }

  return {
    ok: false,
    reason: hadInvalidCandidate ? "invalid_url" : "missing_link",
    recoveryQueued: !!ezgoPortal && guestId != null,
  };
}

export async function isStage2PayAlreadyDispatched(
  supabase: SupabaseClient,
  guestId: string | number,
  triggerType = "stage_2_pay",
): Promise<boolean> {
  const { data } = await supabase
    .from("notification_log")
    .select("id")
    .eq("guest_id", guestId)
    .eq("trigger_type", triggerType)
    .in("status", ["sent", "simulated"])
    .limit(1);
  return !!(data && data.length > 0);
}

export async function isStage2PayInFlight(
  supabase: SupabaseClient,
  guestId: string | number,
  triggerType = "stage_2_pay",
  windowMs = 120_000,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const { data } = await supabase
    .from("notification_log")
    .select("id")
    .eq("guest_id", guestId)
    .eq("trigger_type", triggerType)
    .eq("status", "processing")
    .gte("sent_at", cutoff)
    .limit(1);
  return !!(data && data.length > 0);
}

export async function markStage2PayProcessing(
  supabase: SupabaseClient,
  guestId: string | number,
  phone: string,
  triggerType = "stage_2_pay",
): Promise<void> {
  const { error } = await supabase.from("notification_log").insert({
    guest_id: guestId,
    recipient: phone,
    trigger_type: triggerType,
    channel: "whatsapp",
    status: "processing",
    payload: { context: "Stage 2 Pay dispatch in progress" },
  });
  if (error) {
    console.warn("[paymentLinkGuard] processing marker insert failed:", error.message);
  }
}

export async function logPaymentLinkFailure(
  supabase: SupabaseClient,
  guestId: string | number | null,
  phone: string,
  triggerType: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("notification_log").insert({
    guest_id: guestId,
    recipient: phone,
    trigger_type: triggerType,
    channel: "whatsapp",
    status: "failed_missing_link",
    payload: {
      context: PAYMENT_LINK_FAILURE_CONTEXT,
      error: PAYMENT_LINK_FAILURE_LABEL,
      ...extra,
    },
  });
  if (error) {
    console.warn("[paymentLinkGuard] failed_missing_link log insert error:", error.message);
  }
}
