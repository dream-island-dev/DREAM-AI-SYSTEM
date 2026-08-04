// Email Meirav (groups coordinator) when a spa lead is tagged as a group booking.
// Sent via Orit's connected Graph mailbox — group leads only, never regular guests.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGraphAccessToken, sendGraphNewMail } from "./microsoftGraph.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";

/** SPA_GROUP_LEAD_NOTIFY_EMAIL override; default = Meirav (groups coordinator). */
const DEFAULT_SPA_GROUP_LEAD_EMAIL = "Maayana@dream-island.co.il";

export function resolveSpaGroupLeadNotifyEmail(): string {
  const raw = (Deno.env.get("SPA_GROUP_LEAD_NOTIFY_EMAIL") ?? "").trim();
  return raw || DEFAULT_SPA_GROUP_LEAD_EMAIL;
}

/**
 * Same guest_profile.spa.lead_audience field src/utils/spaUpsellAudience.js's
 * resolveSpaLeadAudience reads on the frontend — kept in sync manually (repo
 * convention: frontend JS mirrors backend TS, no shared import across the
 * client/server boundary). Covers both the manual "קבוצה" tag (task 3,
 * SpaUpsellConfirmModal) and the automated wa.me campaign link
 * (spaGroupCampaign.ts's group_campaign/source='wa_group_link').
 */
export function isSpaGroupLeadGuest(guest: Record<string, unknown> | null | undefined): boolean {
  const profile = guest?.guest_profile as Record<string, unknown> | null | undefined;
  const spa = profile?.spa as Record<string, unknown> | null | undefined;
  if (!spa) return false;
  if (spa.lead_audience === "group") return true;
  if (spa.group_campaign || spa.source === "wa_group_link") return true;
  return false;
}

export function resolveSpaGroupLabel(guest: Record<string, unknown> | null | undefined): string | null {
  const profile = guest?.guest_profile as Record<string, unknown> | null | undefined;
  const spa = profile?.spa as Record<string, unknown> | null | undefined;
  const label = String(spa?.group_label ?? "").trim();
  return label || null;
}

export type SpaGroupLeadNotifyOpts = {
  guestName?: string | null;
  phone: string;
  arrivalDate?: string | null;
  groupLabel?: string | null;
  guestReply?: string | null;
};

export function buildSpaGroupLeadEmailSubject(groupLabel?: string | null): string {
  const label = String(groupLabel ?? "").trim();
  return `💆 ליד ספא חדש — קבוצה${label ? ` (${label})` : ""}`;
}

export function buildSpaGroupLeadEmailBody(opts: SpaGroupLeadNotifyOpts): string {
  const label = String(opts.groupLabel ?? "").trim();
  const lines = [
    `התקבל ליד ספא חדש לקבוצה${label ? ` — ${label}` : ""}.`,
    "",
    `שם: ${opts.guestName || "—"}`,
    `טלפון: ${opts.phone || "—"}`,
    `תאריך הגעה: ${opts.arrivalDate || "—"}`,
  ];
  const reply = String(opts.guestReply ?? "").trim();
  if (reply) lines.push("", `הודעת האורח: "${reply}"`);
  lines.push("", "לשבץ בלוח הספא ולחזור לאורח עם שעה מדויקת 🙏");
  return lines.join("\n");
}

/**
 * Best-effort — never throws. A failed/missing mailbox connection must not
 * block guest_alerts lead creation, it only means Meirav doesn't get an email
 * this time (the lead is still visible on SpaLeadsPage regardless).
 */
export async function notifySpaGroupLeadByEmail(
  supabase: SupabaseClient,
  opts: SpaGroupLeadNotifyOpts,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data: mailbox } = await supabase
      .from("orit_agent_mailbox")
      .select("id, provider, connection_status, read_only_mode, oauth_refresh_token, token_expires_at")
      .eq("connection_status", "active")
      .limit(1)
      .maybeSingle();

    if (!mailbox) return { sent: false, error: "mailbox_not_connected" };
    if (mailbox.read_only_mode !== false) return { sent: false, error: "read_only_mode" };
    if (mailbox.provider !== "microsoft" || !mailbox.oauth_refresh_token) {
      return { sent: false, error: "mailbox_not_sendable" };
    }

    const accessToken = await resolveGraphAccessToken(mailbox as OritMailboxRow, async (next) => {
      await supabase.from("orit_agent_mailbox").update({
        oauth_refresh_token: next.refreshToken ?? mailbox.oauth_refresh_token,
        token_expires_at: next.expiresAt,
      }).eq("id", mailbox.id);
    });

    await sendGraphNewMail(accessToken, {
      toEmail: resolveSpaGroupLeadNotifyEmail(),
      subject: buildSpaGroupLeadEmailSubject(opts.groupLabel),
      bodyText: buildSpaGroupLeadEmailBody(opts),
    });

    return { sent: true };
  } catch (e) {
    console.warn("[spaGroupLeadNotify] email failed:", (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}
