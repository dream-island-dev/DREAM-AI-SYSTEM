// supabase/functions/chat/index.ts
// Edge Function: handles manager chat with Claude.
// Injects agent system prompt + recent learning-log corrections (few-shot).
// Deploy: supabase functions deploy chat

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { messages, agentProfileId, sessionId } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the caller's JWT
    const bearer = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      bearer.replace("Bearer ", "")
    );
    if (authErr || !user) throw new Error("Unauthorized");

    // Load agent profile
    const { data: agent, error: agentErr } = await supabase
      .from("agent_profiles")
      .select("*")
      .eq("id", agentProfileId)
      .single();
    if (agentErr || !agent) throw new Error("Agent profile not found");

    // Load the 5 most recent manager corrections (few-shot learning examples)
    const { data: corrections } = await supabase
      .from("agent_learning_logs")
      .select("original_response, correction, created_at")
      .eq("agent_profile_id", agentProfileId)
      .eq("feedback_type", "correction")
      .not("correction", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    // Build system prompt — base + injected corrections
    let systemPrompt = agent.system_prompt;

    if (corrections && corrections.length > 0) {
      systemPrompt +=
        "\n\n---\n## תיקונים ממשוב המנהל (Few-Shot Learning)\n" +
        "למד מהתיקונים הבאים ואל תחזור על הטעויות:\n\n";

      corrections.forEach((c: any, i: number) => {
        systemPrompt +=
          `**תיקון ${i + 1}**\n` +
          `❌ מה שאמרתי: "${c.original_response.slice(0, 300)}"\n` +
          `✅ מה שהמנהל ציפה: "${c.correction}"\n\n`;
      });
    }

    // Call Claude
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const claudeResponse = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const reply =
      claudeResponse.content[0].type === "text"
        ? claudeResponse.content[0].text
        : "";

    // Persist conversation to history
    const sid = sessionId ?? `session_${Date.now()}`;
    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");

    if (lastUser) {
      const [userMsg, assistantMsg] = [
        {
          agent_profile_id: agentProfileId,
          manager_id: user.id,
          session_id: sid,
          role: "user",
          content: lastUser.content,
        },
        {
          agent_profile_id: agentProfileId,
          manager_id: user.id,
          session_id: sid,
          role: "assistant",
          content: reply,
          tokens_used: claudeResponse.usage.output_tokens,
        },
      ];
      await supabase.from("conversation_history").insert([userMsg, assistantMsg]);
    }

    return new Response(JSON.stringify({ ok: true, reply, sessionId: sid }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
