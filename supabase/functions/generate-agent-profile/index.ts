// supabase/functions/generate-agent-profile/index.ts
// Edge Function: takes questionnaire responses → generates a rich system
// prompt via Gemini (primary) / Claude (fallback) → saves agent_profile
// + questionnaire_responses.
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
      const text = await genGemini(prompt);
      console.log("[router] Gemini succeeded");
      return { text, engine: "gemini" };
    } catch (e) {
      console.error("[router] Gemini failed → Claude:", (e as Error).message);
    }
  }
  try {
    const text = await genClaude(prompt);
    console.log("[router] Claude succeeded");
    return { text, engine: "claude" };
  } catch (e) {
    console.error("[router] Claude also failed:", (e as Error).message);
    // Both failed — return a safe static fallback so the DB save can still proceed
    return { text: "", engine: "claude" };
  }
}

// Department-specific AI context for system prompt generation
const DEPT_CONTEXT: Record<string, string> = {
  housekeeping: "ניקיון וחדרים — תורנויות ניקיון, החלפת מצעים, בקרת איכות חדרים, ניהול ציוד ניקוי, KPIs: אחוז חדרים נקיים בזמן, זמן פנוי ממוצע, תלונות אורחים על ניקיון.",
  maintenance:  "תחזוקה — תיקון תקלות, תחזוקה מונעת, ניהול ציוד טכני, KPIs: זמן תגובה לתקלות (<4h), אחוז תקלות שנפתרו בביקור ראשון, עלות תחזוקה לחדר.",
  reception:    "קבלה ופרונט — צ׳ק-אין/צ׳ק-אאוט, הזמנות, שירות אורחים, KPIs: ציון שביעות רצון (NPS), זמן ממתין בצ׳ק-אין, אחוז אורחים שחזרו.",
  spa:          "ספא ובריאות — לוח תורים לטיפולים, ניהול מטפלים, מוצרי ספא, KPIs: אחוז ניצול קיבולת, הכנסה לשעת מטפל, ביקורות לקוחות.",
  management:   "ניהול כללי — ניהול רוחבי של כל מחלקות המלון, תקצוב, KPIs, דיווח לבעלים, תיאום בין מחלקות, קבלת החלטות אסטרטגיות.",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { responses, department, jobTitle, managerName, driveFolderUrl } =
      await req.json();

    if (!responses || !department || !managerName) {
      throw new Error("missing_required_fields: responses, department, managerName");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Authenticate the caller ─────────────────────────────────────────
    const bearer = req.headers.get("Authorization") ?? "";
    const token = bearer.replace("Bearer ", "").trim();
    if (!token) throw new Error("Unauthorized: no token provided");

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authErr || !user) {
      console.error("[auth] getUser error:", authErr?.message);
      throw new Error(`Unauthorized: ${authErr?.message ?? "invalid token"}`);
    }
    console.log("[auth] user:", user.id, user.email);

    // ── 2. Safety-net: ensure profiles row exists ──────────────────────────
    // The trigger should create this on login, but it can fail silently.
    // INSERT ... ON CONFLICT DO NOTHING is idempotent — safe to always run.
    const avatarText = (
      user.user_metadata?.name ||
      user.email ||
      "M"
    ).slice(0, 2).toUpperCase();

    const { error: profileErr } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        name: user.user_metadata?.name || user.email?.split("@")[0] || managerName,
        email: user.email ?? "",
        role: "staff",
        avatar_text: avatarText,
        avatar: user.user_metadata?.avatar_url ?? null,
        status: "active",
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (profileErr) {
      // Non-fatal: profile likely already exists or status col may not exist
      // in older schema. Log and continue.
      console.warn("[profiles] upsert note:", profileErr.message);
    }

    // ── 2b. Fetch existing agent memory to ground the generated system prompt ─
    const { data: existingMemory } = await supabase
      .from("agent_memory")
      .select("rule_text")
      .eq("manager_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(15);

    const memorySection =
      existingMemory && existingMemory.length > 0
        ? `\nכללי עבודה שהמנהל כבר לימד את הסוכן (ממסמכי עבודה שהועלו):\n` +
          existingMemory
            .map((m: { rule_text: string }) => `• ${m.rule_text}`)
            .join("\n") +
          "\n"
        : "";
    console.log("[generate-agent-profile] memory rules loaded:", existingMemory?.length ?? 0);

    // ── 3. Build the generation prompt ─────────────────────────────────────
    const formatted = Object.entries(responses as Record<string, string>)
      .filter(([, v]) => v && String(v).trim())
      .map(([q, a]) => `שאלה: ${q}\nתשובה: ${a}`)
      .join("\n\n");

    const generationPrompt = `
אתה מומחה בבניית פרופילי סוכן AI לניהול מלון יוקרה.
על-סמך תשובות השאלון הבאות, צור System Prompt מקיף ומדויק בעברית לסוכן AI
שישרת את המנהל באופן אישי.

שם המנהל: ${managerName}
תפקיד: ${jobTitle || "מנהל"}
מחלקה: ${department}
הקשר מחלקה: ${DEPT_CONTEXT[department] || "מחלקת מלון — שירות, ניהול ותפעול."}
קישור Google Drive: ${driveFolderUrl || "לא צוין"}

תשובות השאלון:
${formatted}
${memorySection}
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

    // ── 4. Generate system prompt via AI router ────────────────────────────
    const { text: generatedText, engine } = await generateText(generationPrompt);
    const generatedPrompt =
      generatedText?.trim() ||
      `# סוכן מחלקת ${department}\nאתה עוזר AI אישי של ${managerName} ב-Dream Island Resort.\nתפקידך לסייע בניהול יומיומי של מחלקת ${department}.`;

    console.log("[ai] engine:", engine, "prompt_len:", generatedPrompt.length);

    // ── 5. Save questionnaire responses ───────────────────────────────────
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

    if (qErr) {
      console.error("[db] questionnaire_responses insert:", qErr.message, qErr.details, qErr.hint);
      throw new Error(`db_questionnaire: ${qErr.message}`);
    }

    // ── 6. Upsert agent profile (one per manager) ──────────────────────────
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

    if (agentErr) {
      console.error("[db] agent_profiles upsert:", agentErr.message, agentErr.details, agentErr.hint);
      throw new Error(`db_agent_profile: ${agentErr.message}`);
    }

    // ── 7. Back-link questionnaire → profile ──────────────────────────────
    await supabase
      .from("questionnaire_responses")
      .update({ agent_profile_id: agentProfile.id })
      .eq("id", qRecord.id);

    console.log("[success] agent profile created:", agentProfile.id);

    return new Response(JSON.stringify({ ok: true, engine, agentProfile }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[error]", err.message);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
