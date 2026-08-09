// Single source of truth for "is this a Meta WhatsApp token/auth failure"
// (error code 190 / OAuthException / 401), shared by whatsapp-send's admin
// alert throttle and automation-health-cron's Meta auth probe (P0 2026-08-09)
// so the two never drift on what counts as "the token is dead".

export function isMetaAuthFailure(errorMessage: string | null | undefined): boolean {
  const s = String(errorMessage ?? "");
  return /meta_(template|http)_401|"code":\s*190|OAuthException/i.test(s);
}
