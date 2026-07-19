import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { MorningActionRow } from "./oritSigalBriefing.ts";
import { resolveOritOutboundChannel } from "./oritGuestOutbound.ts";
import { fetchOritDraftText } from "./oritAgentWorkflow.ts";

export const SIGAL_DIGEST_URGENCY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export type SigalDigestOpenThread = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email?: string | null;
  guest_contact_name?: string | null;
  guest_contact_phone?: string | null;
  guest_contact_email?: string | null;
  category: string | null;
  urgency: string | null;
  ai_summary: string | null;
  sla_deadline_at?: string | null;
  auto_ack_sent_at?: string | null;
  orit_wa_contact_at?: string | null;
};

export function israelDigestYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

export async function buildSigalOpenComplaintRows(
  supabase: SupabaseClient,
  threads: SigalDigestOpenThread[],
  now = Date.now(),
): Promise<MorningActionRow[]> {
  const complaintThreads = threads.filter((t) => t.category === "complaint");

  const rows = await Promise.all(
    complaintThreads.map(async (t) => {
      const deadlineMs = t.sla_deadline_at ? new Date(t.sla_deadline_at).getTime() : null;
      const overdue = deadlineMs != null && deadlineMs < now;
      const ack = await fetchOritDraftText(supabase, t.id, "ack");
      const full = await fetchOritDraftText(supabase, t.id, "full_reply");
      const channel = resolveOritOutboundChannel(t);
      return {
        id: t.id,
        subject: t.subject ?? "",
        from_name: t.from_name,
        guest_contact_name: t.guest_contact_name,
        guest_contact_phone: t.guest_contact_phone,
        guest_contact_email: t.guest_contact_email,
        from_email: t.from_email ?? undefined,
        urgency: t.urgency ?? "normal",
        ai_summary: t.ai_summary,
        overdue,
        hours_over: overdue && deadlineMs
          ? Math.max(1, Math.round((now - deadlineMs) / 3_600_000))
          : undefined,
        hours_left: !overdue && deadlineMs
          ? Math.max(1, Math.round((deadlineMs - now) / 3_600_000))
          : undefined,
        hasAckDraft: Boolean(ack?.text?.trim()),
        hasFullDraft: Boolean(full?.text?.trim()),
        channel,
        initialSent: Boolean(t.auto_ack_sent_at || t.orit_wa_contact_at),
      };
    }),
  );

  rows.sort(
    (a, b) =>
      (SIGAL_DIGEST_URGENCY_RANK[a.urgency] ?? 9) - (SIGAL_DIGEST_URGENCY_RANK[b.urgency] ?? 9),
  );
  return rows;
}
