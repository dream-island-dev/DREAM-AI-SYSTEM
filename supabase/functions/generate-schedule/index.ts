// supabase/functions/generate-schedule/index.ts
// AI Shift Generator. Takes a past schedule (parsed rows) + free-text Hebrew
// constraints + the employee roster, and asks Gemini (primary) / Claude
// (fallback) to produce a balanced new weekly schedule as strict JSON.
// Returns { ok, schedule:[...], engine }. Does NOT write to DB — the client
// previews, then inserts on approval.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-6";

// Department-specific scheduling rules injected into the AI prompt
const DEPT_RULES: Record<string, string> = {
  housekeeping: `כללים ייחודיים למחלקת ניקיון וחדרים:
- שיא העומס: בוקר (07:00–12:00) לאחר צ'ק-אאוט; הקפד על צוות מלא בשעות אלה.
- לפחות 2 עובדים בכל משמרת לילה לצורכי ביטחון ושטחים משותפים.
- אל תתזמן עובד לניקיון חדרים ביום שאחרי משמרת לילה שלו.
- יום שישי/שבת — חיזוק צוות עקב שיא אורחים (צ'ק-אאוט המוני).`,

  maintenance: `כללים ייחודיים למחלקת תחזוקה:
- כסה 24/7 עם לפחות טכנאי אחד בכל שלב. משמרות: 06:00–14:00 / 14:00–22:00 / 22:00–06:00.
- קדם עבודות מונעות (inspections, PM) למשמרות בוקר בימי ראשון/שני.
- אל תשלח טכנאי יחיד לעבודה בגובה — דרוש שניים.
- שמור גמישות (על-קריאה) לפחות עובד אחד ביום לתגובה לתקלות דחופות.`,

  reception: `כללים ייחודיים למחלקת קבלה ופרונט:
- פיק צ'ק-אין: 14:00–18:00 — לפחות 3 נציגים בדלפק.
- פיק צ'ק-אאוט: 08:00–12:00 — לפחות 2 נציגים.
- לילה (22:00–06:00): מינימום נציג אחד ערני בדלפק בכל עת.
- אל תשבץ מי שעבד לילה לפתיחת בוקר (פחות מ-8 שעות מנוחה בין משמרות).
- כיסוי שפות: אנגלית חובה בכל משמרת; ערבית / רוסית — עדיפות.`,

  spa: `כללים ייחודיים למחלקת ספא ובריאות:
- הגדר קיבולת טיפולים יומית ואל תעבור 90% ממנה (מרווח לצ'ק-אין ודמי ביטול).
- שיא: שישי–שבת ואחר-הצהריים (14:00–20:00) — חיזוק מטפלים.
- ודא מינימום 30 דקות מעבר בין טיפולים לאותו מטפל (הכנה ואיפוס).
- אם יש טיפולי זוגות — תזמן שני מטפלים בחדר זוגי בו-זמנית.`,

  management: `כללים ייחודיים לניהול כללי:
- ניהול רוחבי — ודא כיסוי מנהלי בכל משמרת בשלוש המחלקות הליבתיות.
- שמור "קצין עסקן" (Duty Manager) 07:00–23:00 כל יום.
- לילה (23:00–07:00): מנהל on-call זמין תוך 30 דקות.
- ישיבת מנהלים שבועית: ראשון בוקר — אל תתזמן משמרת לילה ביום שלפני לאף מנהל.`,
};

function buildPrompt(
  pastShifts: unknown,
  employees: unknown,
  constraints: string,
  weekStart: string,
  department?: string,
) {
  const deptRules = department && DEPT_RULES[department]
    ? `\nכללים ייחודיים למחלקה (${department}) — חובה לכבד:\n${DEPT_RULES[department]}\n`
    : "";

  return `אתה אחראי משאבי אנוש במלון יוקרה "Dream Island". צור סידור משמרות שבועי חדש, מאוזן והוגן.

שבוע מתחיל בתאריך: ${weekStart} (7 ימים).
${department ? `מחלקה: ${department}\n` : ""}
רשימת העובדים הזמינים (JSON):
${JSON.stringify(employees, null, 2)}

סידור המשמרות מהשבוע הקודם (JSON, לשימור דפוסים):
${JSON.stringify(pastShifts, null, 2)}

אילוצים והתאמות מהמנהל (טקסט חופשי — חובה לכבד):
"""
${constraints || "אין אילוצים מיוחדים"}
"""
${deptRules}
כללי בסיס:
1. אזן עומס בין העובדים, שמור על רצף סביר והימנע ממשמרות כפולות באותו יום.
2. כבד כל אילוץ שצוין (חופשות, החלפות, העדפות).
3. שמור על המחלקות מהשבוע הקודם אלא אם צוין אחרת.
4. כל משמרת חייבת: employeeName, department, date (YYYY-MM-DD), start (HH:MM), end (HH:MM), status="עתידי".
${department ? `5. כל שדה "department" בתוצאה חייב להיות בדיוק: "${department}".` : ""}

החזר אך ורק JSON תקין במבנה:
{ "schedule": [ { "employeeName": "...", "department": "...", "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "status": "עתידי" } ] }`;
}

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
        generationConfig: { maxOutputTokens: 4096, temperature: 0.4, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60000),
    }
  );
  if (!res.ok) throw new Error(`gemini_http_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("gemini_empty");
  return text;
}

async function genClaude(prompt: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");
  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: "Return ONLY valid JSON. No prose, no markdown fences.",
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content[0].type === "text" ? resp.content[0].text : "";
}

/** Strip accidental markdown fences and parse JSON. */
function parseSchedule(raw: string): any[] {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const obj = JSON.parse(s);
  const arr = Array.isArray(obj) ? obj : obj.schedule;
  if (!Array.isArray(arr)) throw new Error("model_returned_no_array");
  return arr;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { pastShifts = [], employees = [], constraints = "", weekStart, department } = await req.json();
    if (!weekStart) throw new Error("weekStart is required");

    const prompt = buildPrompt(pastShifts, employees, constraints, weekStart, department);

    let raw = "", engine: "gemini" | "claude" = "gemini";
    if (Deno.env.get("GEMINI_API_KEY")) {
      try { raw = await genGemini(prompt); }
      catch (e) { console.error("[router] Gemini failed → Claude:", (e as Error).message); raw = ""; }
    }
    if (!raw) { raw = await genClaude(prompt); engine = "claude"; }

    const schedule = parseSchedule(raw).map((s: any) => ({
      employeeName: s.employeeName ?? s.employee ?? "",
      // Server-side guarantee: always stamp with the manager's department
      department: department || s.department || "",
      date: s.date ?? weekStart,
      start: s.start ?? "",
      end: s.end ?? "",
      status: s.status ?? "עתידי",
    }));

    return new Response(JSON.stringify({ ok: true, engine, schedule }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
