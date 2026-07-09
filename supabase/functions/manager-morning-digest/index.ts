import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeMorningDigestBullet } from "../_shared/oritAgentAi.ts";
import { managerDigestEnabled } from "../_shared/oritAgentMail.ts";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function israelYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

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
    const { data: mailboxes } = await supabase
      .from("orit_agent_mailbox")
      .select("id, profile_id, digest_enabled")
      .eq("digest_enabled", true);

    let sent = 0;
    for (const mailbox of mailboxes ?? []) {
      const { data: existing } = await supabase
        .from("orit_agent_digest_log")
        .select("id")
        .eq("mailbox_id", mailbox.id)
        .eq("digest_date", digestDate)
        .maybeSingle();
      if (existing) continue;

      let phone: string | null = null;
      if (mailbox.profile_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", mailbox.profile_id)
          .maybeSingle();
        phone = profile?.phone ?? null;
      }

      if (!phone) {
        console.warn("[manager-morning-digest] no phone for mailbox", mailbox.id);
        continue;
      }

      const { data: openThreads } = await supabase
        .from("orit_agent_threads")
        .select("subject, from_name, sla_deadline_at, status, auto_ack_sent_at, handled_at, received_at")
        .eq("mailbox_id", mailbox.id)
        .eq("status", "awaiting_reply")
        .eq("is_demo", false);

      const now = Date.now();
      const overdue = (openThreads ?? []).filter((t) => t.sla_deadline_at && new Date(t.sla_deadline_at).getTime() < now)
        .map((t) => ({
          subject: t.subject,
          from_name: t.from_name,
          hours_over: Math.max(1, Math.round((now - new Date(t.sla_deadline_at!).getTime()) / 3_600_000)),
        }));

      const waiting = (openThreads ?? []).filter((t) => !t.sla_deadline_at || new Date(t.sla_deadline_at).getTime() >= now)
        .map((t) => ({
          subject: t.subject,
          from_name: t.from_name,
          hours_left: t.sla_deadline_at
            ? Math.max(1, Math.round((new Date(t.sla_deadline_at).getTime() - now) / 3_600_000))
            : 72,
        }));

      const yesterdayStart = new Date();
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setHours(23, 59, 59, 999);

      const { count: handledYesterday } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("status", "handled")
        .gte("handled_at", yesterdayStart.toISOString())
        .lte("handled_at", yesterdayEnd.toISOString());

      const { count: newYesterday } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("is_demo", false)
        .gte("received_at", yesterdayStart.toISOString())
        .lte("received_at", yesterdayEnd.toISOString());

      const body = await composeMorningDigestBullet({
        overdue,
        waiting,
        handledYesterday: handledYesterday ?? 0,
        newYesterday: newYesterday ?? 0,
      });

      const whapiId = await sendWhapiText(phone.replace(/\D/g, ""), body, { noLinkPreview: true });
      if (!whapiId) {
        console.warn("[manager-morning-digest] whapi send failed");
        continue;
      }

      await supabase.from("orit_agent_digest_log").insert({
        mailbox_id: mailbox.id,
        digest_date: digestDate,
        body_sent: body,
        whapi_message_id: whapiId,
      });
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
