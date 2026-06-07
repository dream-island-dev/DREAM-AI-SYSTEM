// supabase/functions/generate-agent-profile/index.ts
// Edge Function: takes questionnaire responses → generates a rich system
// prompt via Claude Sonnet → saves agent_profile + questionnaire_responses.
// Deploy: supabase functions deploy generate-agent-profile

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Model router: Gemini (primary) → Claude (fallback) ────────────────────────
// gemini-2.5-flash is free-tier eligible; 2.5-pro requires billing (429 limit:0).
const GEMINI_MODEL = "gemini-2.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-6";

/** Single-shot text generation via Gemini, throws on any failure. */
async function genGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no_gemini_key");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!res.ok) {
    const body = await res.text();
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

/** Single-shot text generation via Claude. */
async function genClaude(prompt: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");
  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content[0].type === "text" ? resp.content[0].text : "";
}

/** Try Gemini first, fall back to Claude. Returns text + which engine. */
async function generateText(
  prompt: string
): Promise<{ text: string; engine: "gemini" | "claude" }> {
  if (Deno.env.get("GEMINI_API_KEY")) {
    try {
      return { text: await genGemini(prompt), engine: "gemini" };
    } catch (e) {
      console.error("[router] Gemini failed → Claude:", (e as Error).message);
    }
  }
  return { text: await genClaude(prompt), engine: "claude" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { responses, department, managerName, driveFolderUrl } =
      await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const bearer = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      bearer.replace("Bearer ", "")
    );
    if (authErr || !user) throw new Error("Unauthorized");

    // Craft a richer system prompt from the raw questionnaire via the router
    // (Gemini primary → Claude fallback).
    const formatted = Object.entries(responses as Record<string, string>)
      .map(([q, a]) => `שאלה: ${q}\nתשובה: ${a}`)
      .join("\n\n");

    const generationPrompt = `
אתה מומחה בבניית פרופילי סוכן AI לניהול מלון יוקרה.
על-סמך תשובות השאלון הבאות, צור System Prompt מקיף ומדויק בעברית לסוכן AI
שישרת את המנהל באופן אישי.

שם המנהל: ${managerName}
מחלקה: ${department}
קישור Google Drive: ${driveFolderUrl || "לא צוין"}

תשובות השאלון:
${formatted}

---
הנחיות לבניית ה-System Prompt:
1. פתח עם הגדרת זהות ברורה (שם הסוכן, המחלקה, שם המנהל).
2. פרט את אחריות המחלקה ואתגריה הייחודיים.
3. ציין KPIs ומדדים שחשוב לעקוב.
4. הגדר סגנון תקשורת ספציפי לפי העדפת המנהל.
5. ציין במפורש נושאים שדורשים זהירות / אישור מנהל.
6. הוסף כללי עבודה ברורים (עברית, מבנה תשובות וכו').
7. אם יש קישור Drive — הזכר אותו.

החזר רק את ה-System Prompt עצמו, ללא כותרות נוספות.
`.trim();

    const { text: generatedText } = await generateText(generationPrompt);
    const generatedPrompt =
      generatedText?.trim() ||
      `# סוכן מחלקת ${department}\nאתה עוזר AI של ${managerName}.`;

    // Save questionnaire responses first
    const { data: qRecord, error: qErr } = await supabase
      .from("questionnaire_responses")
      .insert({
        manager_id: user.id,
        department,
        responses,
        drive_folder_url: driveFolderUrl ?? null,
      })
      .select()
      .single();

    if (qErr) throw qErr;

    // Upsert agent profile (one per manager)
    const { data: agentProfile, error: agentErr } = await supabase
      .from("agent_profiles")
      .upsert(
        {
          manager_id: user.id,
          department,
          display_name: `סוכן ${department}`,
          system_prompt: generatedPrompt,
          drive_folder_url: driveFolderUrl ?? null,
          questionnaire_id: qRecord.id,
          personality_traits: {
            communication_style: responses.communication_style ?? "formal",
          },
          is_active: true,
        },
        { onConflict: "manager_id" }
      )
      .select()
      .single();

    if (agentErr) throw agentErr;

    // Link questionnaire back to the profile
    await supabase
      .from("questionnaire_responses")
      .update({ agent_profile_id: agentProfile.id })
      .eq("id", qRecord.id);

    return new Response(JSON.stringify({ ok: true, agentProfile }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
