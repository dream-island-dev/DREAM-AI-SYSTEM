import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasOritCsAgentAccess } from "../_shared/oritCsAgentAccess.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized", hint: "התחבר מחדש ל-XOS" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized", hint: userErr?.message }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("orit_cs_agent_access, role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!hasOritCsAgentAccess(profile)) {
      return new Response(JSON.stringify({
        ok: false,
        error: "forbidden",
        hint: "אין הרשאה לסוכן שירות לקוחות — פנה למנהל מערכת",
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: mailboxes, error: mbErr } = await supabase
      .from("orit_agent_mailbox")
      .select("id, profile_id, owner_email, email_address, provider, connection_status, read_only_mode, last_sync_at, sla_hours, digest_enabled, digest_whatsapp_phone, alert_enabled, connection_error")
      .order("connection_status", { ascending: true })
      .order("last_sync_at", { ascending: false })
      .limit(5);

    if (mbErr) {
      return new Response(JSON.stringify({ ok: false, error: mbErr.message }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const mailbox = (mailboxes ?? []).find((m) => m.connection_status === "active") ?? mailboxes?.[0] ?? null;
    if (!mailbox) {
      return new Response(JSON.stringify({ ok: false, error: "mailbox_not_found" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!mailbox.profile_id) {
      await supabase.from("orit_agent_mailbox").update({ profile_id: userData.user.id }).eq("id", mailbox.id);
      mailbox.profile_id = userData.user.id;
    }

    let threadsQ = supabase
      .from("orit_agent_threads")
      .select("*")
      .eq("mailbox_id", mailbox.id)
      .eq("is_demo", false)
      .order("received_at", { ascending: false });
    const { data: threads, error: thErr } = await threadsQ;
    if (thErr) {
      return new Response(JSON.stringify({ ok: false, error: thErr.message }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, mailbox, threads: threads ?? [] }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[orit-cs-bootstrap]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
