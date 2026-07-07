// Shared helpers for Orit Customer Service Agent (manager mail module).

export type OritMailboxRow = {
  id: string;
  profile_id: string | null;
  owner_email: string;
  email_address: string | null;
  connection_status: string;
  auto_ack_enabled: boolean;
  auto_ack_template: string;
  sla_hours: number;
  oauth_refresh_token: string | null;
  token_expires_at: string | null;
  sync_cursor: string | null;
};

export type OritThreadRow = {
  id: string;
  mailbox_id: string;
  subject: string;
  from_email: string;
  from_name: string | null;
  snippet: string | null;
  received_at: string;
  status: string;
  urgency: string;
  urgency_reason: string | null;
  category: string;
  ai_summary: string | null;
  auto_ack_sent_at: string | null;
  sla_deadline_at: string | null;
  is_demo: boolean;
};

const NOREPLY_RE = /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)@/i;
const INTERNAL_DOMAIN_RE = /@dream-island\.co\.il$/i;

export function isMicrosoftConfigured(): boolean {
  return Boolean(
    Deno.env.get("MICROSOFT_CLIENT_ID") &&
      Deno.env.get("MICROSOFT_CLIENT_SECRET") &&
      Deno.env.get("MICROSOFT_TENANT_ID"),
  );
}

export function managerMailEnabled(): boolean {
  return Deno.env.get("MANAGER_MAIL_ENABLED") === "true";
}

export function managerDigestEnabled(): boolean {
  return Deno.env.get("MANAGER_DIGEST_ENABLED") === "true";
}

export function renderAutoAckTemplate(
  template: string,
  guestName: string,
  subject: string,
): string {
  const name = (guestName || "").trim() || "שלום";
  const subj = (subject || "").trim() || "פנייתך";
  return template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name)
    .replace(/\{\{\s*SUBJECT\s*\}\}/gi, subj)
    .trim();
}

export function shouldAutoAckInbound(fromEmail: string, isDemo: boolean): boolean {
  if (isDemo) return false;
  const email = (fromEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return false;
  if (NOREPLY_RE.test(email)) return false;
  if (INTERNAL_DOMAIN_RE.test(email)) return false;
  return true;
}

export function computeSlaDeadline(receivedAtIso: string, slaHours: number): string {
  const base = new Date(receivedAtIso);
  const ms = base.getTime() + slaHours * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export function urgencySortRank(urgency: string, slaDeadlineAt: string | null): number {
  const rank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  let score = rank[urgency] ?? 9;
  if (slaDeadlineAt) {
    const overdue = new Date(slaDeadlineAt).getTime() < Date.now();
    if (overdue) score -= 0.5;
  }
  return score;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
