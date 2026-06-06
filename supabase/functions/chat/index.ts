// supabase/functions/chat/index.ts
// Edge Function: handles manager chat with Claude.
// Receives messages + agentProfile + learningLogs from the frontend.
// No Supabase Auth required — security via ANTHROPIC_API_KEY server-side secret.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { messages, agentProfile, learningLogs } = await req.json();

    // Build system prompt — base profile + injected corrections from learning logs
    let systemPrompt =
      agentProfile?.systemPrompt ??
      "אתה DreamBot, עוזר AI חכם של מלון Dream Island. ענה תמיד בעברית.";

    if (learningLogs && learningLogs.length > 0) {
      systemPrompt +=
        "\n\n---\n## תיקונים ממשוב המנהל (Few-Shot Learning)\n" +
        "למד מהתיקונים הבאים ואל תחזור על הטעויות:\n\n";
      learningLogs.forEach((c: any, i: number) => {
        systemPrompt +=
          `**תיקון ${i + 1}**\n` +
          `❌ מה שאמרתי: "${(c.original_response ?? "").slice(0, 300)}"\n` +
          `✅ מה שהמנהל ציפה: "${c.correction}"\n\n`;
      });
    }

    // Call Claude
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
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

    return new Response(JSON.stringify({ ok: true, reply }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
