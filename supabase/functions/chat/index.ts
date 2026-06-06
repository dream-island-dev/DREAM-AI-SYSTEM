// supabase/functions/chat/index.ts
// Stateful chat Edge Function:
//   1. Loads last N messages from chat_history (DB-backed session)
//   2. Fetches relevant Drive content via Apps Script bridge (RAG)
//   3. Builds: system prompt + drive context + learning logs + history + new message
//   4. Calls Claude
//   5. Saves both messages to chat_history

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HISTORY_LIMIT = 10; // last N messages loaded per session

// ── Google Drive RAG via Apps Script bridge ───────────────────────────────────
async function fetchDriveContext(
  appsScriptUrl: string,
  driveFolderUrl: string,
  query: string
): Promise<string> {
  try {
    const url = new URL(appsScriptUrl);
    url.searchParams.set("action", "search");
    url.searchParams.set("folder", driveFolderUrl);
    url.searchParams.set("query", query.slice(0, 200)); // safety trim

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "";

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.results) || data.results.length === 0)
      return "";

    let ctx =
      "\n\n---\n## מסמכים רלוונטיים מ-Google Drive המחלקתי\n" +
      "המידע הבא נמצא בתיקיית הדרייב של המחלקה ורלוונטי לשאלתך:\n\n";

    data.results.forEach((r: { name: string; snippet: string }) => {
      ctx += `**📄 ${r.name}**\n${r.snippet}\n\n`;
    });

    return ctx;
  } catch {
    // Drive RAG is best-effort — never crash the main response
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      message,       // current user message (string)
      sessionId,     // persistent session ID from localStorage
      managerId,     // manager identifier (mock or Supabase UUID)
      agentProfile,  // { id, systemPrompt, department, displayName, driveUrl }
      learningLogs,  // recent manager corrections for few-shot injection
    } = await req.json();

    if (!message || !sessionId)
      throw new Error("message and sessionId are required");

    // Supabase client with service-role to bypass RLS
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Load conversation history from DB ─────────────────────────────────
    const { data: history } = await supabase
      .from("chat_history")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT);

    // ── 2. Google Drive RAG ──────────────────────────────────────────────────
    const appsScriptUrl = Deno.env.get("APPS_SCRIPT_URL");
    const driveUrl = agentProfile?.driveUrl;
    let driveContext = "";

    if (appsScriptUrl && driveUrl) {
      driveContext = await fetchDriveContext(appsScriptUrl, driveUrl, message);
    }

    // ── 3. Build system prompt ───────────────────────────────────────────────
    let systemPrompt =
      agentProfile?.systemPrompt ??
      "אתה DreamBot, עוזר AI חכם של מלון Dream Island. ענה תמיד בעברית.";

    // Inject Drive RAG context (if found)
    if (driveContext) {
      systemPrompt += driveContext;
    }

    // Inject learning-log corrections as few-shot examples
    if (Array.isArray(learningLogs) && learningLogs.length > 0) {
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

    // ── 4. Build messages array: DB history + new user message ───────────────
    const messages = [
      ...(history ?? []).map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: message },
    ];

    // ── 5. Call Claude ───────────────────────────────────────────────────────
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    const reply =
      claudeResponse.content[0].type === "text"
        ? claudeResponse.content[0].text
        : "";

    // ── 6. Persist both messages to DB ───────────────────────────────────────
    const agentId = agentProfile?.id ?? "unknown";
    const mgrId = managerId ?? "anonymous";

    await supabase.from("chat_history").insert([
      { session_id: sessionId, agent_id: agentId, manager_id: mgrId, role: "user",      content: message },
      { session_id: sessionId, agent_id: agentId, manager_id: mgrId, role: "assistant", content: reply   },
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        reply,
        driveUsed: Boolean(driveContext),   // lets the UI show a Drive indicator
        historyCount: (history ?? []).length,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
