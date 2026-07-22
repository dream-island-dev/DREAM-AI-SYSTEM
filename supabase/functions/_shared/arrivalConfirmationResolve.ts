import {
  isArrivalConfirmationMessage,
  isArrivalDeclineMessage,
  normalizeInboundConfirmText,
} from "./arrivalConfirmation.ts";
import {
  ARRIVAL_CONFIRM_AI_MIN_CONFIDENCE,
  classifyArrivalConfirmationWithAi,
  isGuestAwaitingArrivalConfirmationReply,
} from "./arrivalConfirmationAi.ts";

/** Sync Tier-0 only — buttons, template phrases, explicit declines. No Gemini. */
export function isArrivalConfirmationTier0(
  raw: string,
  opts?: { buttonTitle?: string; buttonId?: string; isButtonReply?: boolean },
): boolean {
  const text = normalizeInboundConfirmText(raw);

  if (opts?.isButtonReply) {
    const title = normalizeInboundConfirmText(opts.buttonTitle ?? "");
    return isArrivalConfirmationMessage(title || text, {
      buttonTitle: opts.buttonTitle,
      buttonId: opts.buttonId,
    });
  }

  if (text && isArrivalDeclineMessage(text)) return false;
  return isArrivalConfirmationMessage(text, opts);
}

export type ArrivalConfirmationResolution = "confirm" | "decline" | "none";

/**
 * Tier-0 first (free), then Gemini semantic classify when the guest is awaiting
 * a Stage 1 reply. Fail-closed outside that funnel. AI results are memoized
 * per guest+text for 120s to avoid duplicate calls across webhook paths.
 */
export async function resolveArrivalConfirmationIntent(
  raw: string,
  guest: Record<string, unknown> | null,
  opts?: { buttonTitle?: string; buttonId?: string; isButtonReply?: boolean },
): Promise<ArrivalConfirmationResolution> {
  const text = normalizeInboundConfirmText(raw);

  if (opts?.isButtonReply) {
    const title = normalizeInboundConfirmText(opts.buttonTitle ?? "");
    if (title && isArrivalDeclineMessage(title)) return "decline";
    return isArrivalConfirmationMessage(title || text, {
      buttonTitle: opts.buttonTitle,
      buttonId: opts.buttonId,
    })
      ? "confirm"
      : "none";
  }

  if (text && isArrivalDeclineMessage(text)) return "decline";
  if (isArrivalConfirmationMessage(text, opts)) return "confirm";
  if (!text || !isGuestAwaitingArrivalConfirmationReply(guest)) return "none";

  const guestId = guest?.id as number | string | null | undefined;
  const ai = await classifyArrivalConfirmationWithAi(text, { guestId });
  if (ai.intent === "confirm" && ai.confidence >= ARRIVAL_CONFIRM_AI_MIN_CONFIDENCE) {
    return "confirm";
  }
  if (ai.intent === "decline" && ai.confidence >= ARRIVAL_CONFIRM_AI_MIN_CONFIDENCE) {
    return "decline";
  }
  return "none";
}

export async function resolveArrivalConfirmation(
  raw: string,
  guest: Record<string, unknown> | null,
  opts?: { buttonTitle?: string; buttonId?: string; isButtonReply?: boolean },
): Promise<boolean> {
  return (await resolveArrivalConfirmationIntent(raw, guest, opts)) === "confirm";
}
