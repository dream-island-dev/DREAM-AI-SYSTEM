import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeMorningDigestBullet } from "../_shared/oritAgentAi.ts";
import { managerDigestEnabled } from "../_shared/oritAgentMail.ts";
import { resolveOritAlertPhone } from "../_shared/oritAgentWhapiAlert.ts";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function israelYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!managerDigestEnabled()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "MANAGER_DIGEST_ENABLED=false" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const digestDate = israelYmd();
    const force = (await req.json().catch(() => ({}))).force === true;

    const { data: mailboxes } = await supabase
      .from("orit_agent_mailbox")
      .select("id, profile_id, digest_enabled, digest_whatsapp_phone, alert_enabled")
      .eq("digest_enabled", true);

    const now = Date.now();
    const since24h = new Date(now - 24 * 3_600_000).toISOString();

    const yesterdayStart = new Date();
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(23, 59, 59, 999);

    let sent = 0;
    for (const mailbox of mailboxes ?? []) {
      if (!force) {
        const { data: existing } = await supabase
          .from("orit_agent_digest_log")
          .select("id")
          .eq("mailbox_id", mailbox.id)
          .eq("digest_date", digestDate)
          .maybeSingle();
        if (existing) continue;
      }

      const phone = await resolveOritAlertPhone(supabase, mailbox);
      if (!phone) {
        console.warn("[manager-morning-digest] no phone for mailbox", mailbox.id);
        continue;
      }

      const { data: openThreads } = await supabase
        .from("orit_agent_threads")
        .select("id, subject, from_name, guest_contact_name, category, urgency, ai_summary, sla_deadline_at, status, received_at")
        .eq("mailbox_id", mailbox.id)
        .eq("status", "awaiting_reply")
        .eq("is_demo", false);

      const openComplaints = (openThreads ?? [])
        .filter((t) => t.category === "complaint")
        .map((t) => {
          const deadlineMs = t.sla_deadline_at ? new Date(t.sla_deadline_at).getTime() : null;
          const overdue = deadlineMs != null && deadlineMs < now;
          return {
            id: t.id,
            subject: t.subject,
            from_name: t.from_name,
            guest_contact_name: t.guest_contact_name,
            urgency: t.urgency,
            ai_summary: t.ai_summary,
            overdue,
            hours_over: overdue && deadlineMs
              ? Math.max(1, Math.round((now - deadlineMs) / 3_600_000))
              : undefined,
            hours_left: !overdue && deadlineMs
              ? Math.max(1, Math.round((deadlineMs - now) / 3_600_000))
              : undefined,
          };
        })
        .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9));

      const otherOpenCount = (openThreads ?? []).filter((t) => t.category !== "complaint").length;

      const { count: leadsLast24h } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("is_demo", false)
        .eq("category", "lead")
        .gte("received_at", since24h);

      const { count: handledYesterday } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("status", "handled")
        .gte("handled_at", yesterdayStart.toISOString())
        .lte("handled_at", yesterdayEnd.toISOString());

      const body = await composeMorningDigestBullet({
        openComplaints,
        leadsLast24h: leadsLast24h ?? 0,
        otherOpenCount,
        handledYesterday: handledYesterday ?? 0,
      });

      const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
      if (!whapiId) {
        console.warn("[manager-morning-digest] whapi send failed");
        continue;
      }

      await supabase.from("orit_agent_digest_log").upsert({
        mailbox_id: mailbox.id,
        digest_date: digestDate,
        body_sent: body,
        whapi_message_id: whapiId,
        sent_at: new Date().toISOString(),
      }, { onConflict: "mailbox_id,digest_date" });

      sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-morning-digest]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
