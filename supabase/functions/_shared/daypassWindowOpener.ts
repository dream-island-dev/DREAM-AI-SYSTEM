/**
 * Day-pass 24h-window opener (Option C, 2026-07-13).
 *
 * Meta Dream Bot can only send free-form after the guest replies. Whapi can
 * send free-form anytime but may fail (ban/SOS) — then Dream Bot needs either
 * an open window or a Meta template. A Quick Reply / typed "מחכים לכם!" on
 * evening/morning opens that window so spa_warmup + survey can ride session.
 */

export const DAYPASS_WINDOW_OPENER_LABEL = "מחכים לכם!";

export const DAYPASS_WINDOW_OPENER_CTA_HE =
  `נשמח לאישור קצר — לחצו «${DAYPASS_WINDOW_OPENER_LABEL}» או כתבו את זה כאן 🌴`;

/** Soft ack after the guest taps/types the opener — keeps tone light. */
export const DAYPASS_WINDOW_OPENER_ACK_HE =
  "מעולה! מחכים לכם בדרים איילנד 🌴 אנחנו כאן לכל שאלה בדרך.";

const OPENER_RE = /מחכים\s*לכם|אנחנו\s*בדרך|בדרך\s*אליכם/i;

export function isDaypassWindowOpenerMessage(
  text: string | null | undefined,
  opts?: { buttonTitle?: string | null },
): boolean {
  const btn = String(opts?.buttonTitle ?? "").trim();
  if (btn.includes("מחכים")) return true;
  const t = String(text ?? "").trim();
  if (!t) return false;
  return OPENER_RE.test(t);
}

/** Append CTA once when Whapi/plain path has no interactive buttons. */
export function ensureDaypassWindowOpenerCta(body: string): string {
  const raw = String(body ?? "");
  if (/מחכים\s*לכם/i.test(raw)) return raw;
  return `${raw.trimEnd()}\n\n${DAYPASS_WINDOW_OPENER_CTA_HE}`;
}

/** Stages that prefer Meta free-text session when wa_window is open. */
export const DAYPASS_SESSION_FIRST_TRIGGERS = new Set([
  "night_before_daypass",
  "spa_warmup_daypass",
  "survey_invite_daypass",
  "mid_stay_daypass",
  "checkout_fb_daypass",
]);
