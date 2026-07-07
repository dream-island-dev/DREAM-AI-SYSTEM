import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeOritThread } from "../_shared/oritAgentAi.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { threadId } = await req.json();
    if (!threadId) {
      return new Response(JSON.stringify({ ok: false, error: "threadId required" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: thread } = await supabase
      .from("orit_agent_threads")
      .select("*, orit_agent_mailbox!inner(id, profile_id, owner_email)")
      .eq("id", threadId)
      .maybeSingle();

    if (!thread) {
      return new Response(JSON.stringify({ ok: false, error: "thread_not_found" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: msgs } = await supabase
      .from("orit_agent_messages")
      .select("body_text, direction")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true });

    const inbound = (msgs ?? []).filter((m) => m.direction === "inbound").map((m) => m.body_text).join("\n");

    const { data: samples } = await supabase
      .from("orit_agent_style_samples")
      .select("inbound_snippet, outbound_text, context_category")
      .eq("mailbox_id", thread.mailbox_id)
      .order("created_at", { ascending: false })
      .limit(8);

    const analysis = await analyzeOritThread({
      subject: thread.subject,
      fromName: thread.from_name,
      fromEmail: thread.from_email,
      bodyText: inbound || thread.snippet || "",
      styleSamples: samples ?? [],
    });

    await supabase.from("orit_agent_threads").update({
      urgency: analysis.urgency,
      urgency_reason: analysis.urgency_reason,
      category: analysis.category,
      ai_summary: analysis.summary,
      ai_analyzed_at: new Date().toISOString(),
    }).eq("id", threadId);

    await supabase.from("orit_agent_drafts").delete().eq("thread_id", threadId).eq("status", "suggested");
    if (analysis.suggestions.length) {
      await supabase.from("orit_agent_drafts").insert(
        analysis.suggestions.map((text) => ({
          thread_id: threadId,
          suggested_text: text,
          status: "suggested",
          created_by: userData.user.id,
        })),
      );
    }

    return new Response(JSON.stringify({ ok: true, analysis }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-analyze]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
