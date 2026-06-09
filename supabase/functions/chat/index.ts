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

// ── Model router: Gemini (primary) → Claude (fallback) ────────────────────────
//
// Gemini is the DEFAULT engine for all agent interactions. If GEMINI_API_KEY is
// absent, or Gemini errors / hits quota, the request transparently falls back to
// Anthropic Claude. The system runs end-to-end on Claude alone until the Gemini
// key is added — zero downtime when it arrives.

// gemini-2.5-flash is available on the free tier; 2.5-pro / 2.0 require billing
// (returned 429 limit:0). Swap back to gemini-2.5-pro once billing is enabled.
const GEMINI_MODEL = "gemini-2.5-flash";      // primary engine (free-tier ok)
const CLAUDE_MODEL = "claude-sonnet-4-6";     // fallback engine

type ChatMsg = { role: "user" | "assistant"; content: string };

async function callGemini(systemPrompt: string, messages: ChatMsg[]): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no_gemini_key");

  // Anthropic-style roles → Gemini roles ("assistant" → "model")
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    // 429 = quota/limit → caller falls back to Claude
    throw new Error(`gemini_http_${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? "";

  if (!text.trim()) throw new Error("gemini_empty_response");
  return text;
}

async function callClaude(systemPrompt: string, messages: ChatMsg[]): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });
  return resp.content[0].type === "text" ? resp.content[0].text : "";
}

/** Try Gemini first; on any failure fall back to Claude. */
async function routeChat(
  systemPrompt: string,
  messages: ChatMsg[]
): Promise<{ reply: string; engine: "gemini" | "claude" }> {
  if (Deno.env.get("GEMINI_API_KEY")) {
    try {
      const reply = await callGemini(systemPrompt, messages);
      return { reply, engine: "gemini" };
    } catch (e) {
      console.error("[router] Gemini failed → falling back to Claude:", (e as Error).message);
    }
  }
  const reply = await callClaude(systemPrompt, messages);
  return { reply, engine: "claude" };
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

    // ── 2b. Agent Long-Term Memory (Pillar 3) ────────────────────────────────
    let memoryContext = "";
    if (managerId && managerId !== "anonymous") {
      const { data: memories } = await supabase
        .from("agent_memory")
        .select("rule_text, category")
        .eq("manager_id", managerId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(20);

      if (memories && memories.length > 0) {
        memoryContext =
          "\n\n---\n## כללי עבודה שהמנהל לימד את הסוכן\n" +
          "אלה כללי עבודה שהמנהל העלה ממסמכי עבודה — יש לכבד אותם תמיד:\n\n" +
          memories
            .map((m: { rule_text: string }, i: number) => `${i + 1}. ${m.rule_text}`)
            .join("\n");
        console.log("[chat] injecting", memories.length, "memory rules for manager:", managerId);
      }
    }

    // ── 3. Build system prompt ───────────────────────────────────────────────
    let systemPrompt =
      agentProfile?.systemPrompt ??
      "אתה DreamBot, עוזר AI חכם של מלון Dream Island. ענה תמיד בעברית.";

    // Inject Drive RAG context (if found)
    if (driveContext) {
      systemPrompt += driveContext;
    }

    // Inject long-term memory rules (Pillar 3)
    if (memoryContext) {
      systemPrompt += memoryContext;
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

    // ── 5. Generate reply via model router (Gemini → Claude fallback) ─────────
    const { reply, engine } = await routeChat(systemPrompt, messages);

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
        engine,                              // "gemini" | "claude" — which model answered
        driveUsed: Boolean(driveContext),   // lets the UI show a Drive indicator
        historyCount: (history ?? []).length,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[chat] error:", raw);

    // Map internal error codes → actionable Hebrew messages
    let userError = raw;
    if (raw === "no_gemini_key" || raw === "no_anthropic_key") {
      userError =
        "לא הוגדר מפתח AI ב-Supabase Secrets. הרץ:\n" +
        "  npx supabase secrets set GEMINI_API_KEY=<your-key> --project-ref <ref>";
    } else if (raw.includes("gemini_http_429") || raw.includes("quota")) {
      userError = "מכסת Gemini מוצתה (429) — נסה שוב מאוחר יותר.";
    } else if (raw.includes("gemini_http_")) {
      userError = `שגיאת Gemini API: ${raw}`;
    }

    // ⚠️  Always HTTP 200 — supabase-js populates `data` (not `error`) so the
    //     frontend receives the real error string instead of a generic wrapper.
    return new Response(
      JSON.stringify({ ok: false, error: userError }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
