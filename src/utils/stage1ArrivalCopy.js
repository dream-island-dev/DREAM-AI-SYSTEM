/**
 * Stage 1 (pre_arrival_2d) outbound copy helpers — mirrors whatsapp-send BRANCH D
 * + ensureArrivalConfirmationCta for ACC / BotScriptEditor true previews.
 * Keep CTA logic in sync with supabase/functions/_shared/arrivalConfirmation.ts
 */

import {
  ARRIVAL_CONFIRM_CTA_HE,
  ensureArrivalConfirmationCta,
  bodyAlreadyHasConfirmCta,
  isArrivalConfirmationMessage,
} from "./arrivalConfirmation";

export {
  ARRIVAL_CONFIRM_CTA_HE,
  ensureArrivalConfirmationCta,
  bodyAlreadyHasConfirmCta,
  isArrivalConfirmationMessage,
};

export const STAGE1_AUTO_APPEND_CTA_KEY = "stage1_auto_append_cta";

export const STAGE1_SAMPLE_GUEST_NAME = "דניאל כהן";

/** bot_config value — default ON unless explicitly "false". */
export function parseStage1AutoAppendCta(configValue) {
  return String(configValue ?? "true").trim().toLowerCase() !== "false";
}

/** Meta template {{1}} → bot_scripts {{GUEST_NAME}} for Stage 1 copy. */
export function metaTemplateBodyToBotScript(metaBody) {
  return String(metaBody ?? "")
    .replace(/\{\{\s*1\s*\}\}/g, "{{GUEST_NAME}}")
    .trim();
}

export function resolveStage1Placeholders(template, guestName = STAGE1_SAMPLE_GUEST_NAME) {
  const name = (String(guestName ?? "").trim()) || "אורח יקר";
  return String(template ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name)
    .replace(/\{\{\s*portal_url\s*\}\}/gi, "https://dream-ai-system.vercel.app/portal/example")
    .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, "");
}

/**
 * Exact outbound body for Whapi / session_message on Stage 1 (after placeholders + optional CTA).
 */
export function resolveStage1OutboundBody(scriptText, opts = {}) {
  const {
    guestName = STAGE1_SAMPLE_GUEST_NAME,
    autoAppendCta = true,
  } = opts;
  const resolved = resolveStage1Placeholders(scriptText, guestName);
  return ensureArrivalConfirmationCta(resolved, { autoAppend: autoAppendCta });
}

/** Whether the auto-append safety net will add a line to the draft. */
export function stage1WillAutoAppendCta(scriptText, autoAppendCtaEnabled) {
  if (!autoAppendCtaEnabled) return false;
  const resolved = resolveStage1Placeholders(scriptText);
  return !bodyAlreadyHasConfirmCta(resolved);
}
