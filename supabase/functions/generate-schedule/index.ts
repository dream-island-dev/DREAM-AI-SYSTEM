// supabase/functions/generate-schedule/index.ts  v5
// ══════════════════════════════════════════════════════════════════════════════
// SMART SCHEDULE GENERATOR — Dream Island
//
// v5 changes:
//   • Anthropic fallback REMOVED (all model names return 404 — key restricted)
//   • DUPLICATE mode (no constraints) now runs client-side in ShiftGenerator.js
//     This Edge Function is called ONLY when AI is needed:
//       A. employeeProfiles + constraints → Gemini applies exceptions
//       B. no profiles at all            → Gemini creates from scratch
//   • Better Hebrew error messages for quota exceeded
//   • Always return HTTP 200 — errors in { ok:false, error: "..." }
//
// Input:  { pastShifts, employees, constraints, weekStart, department,
//            managerId, excelSchema, employeeProfiles }
// Output: { ok, schedule: [...], engine, mode }
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.0-flash";

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.1,          // low = more faithful copy
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(90000),
    }
  );
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("gemini_empty_response");
  return text;
}

// ── Call AI — Gemini only ─────────────────────────────────────────────────────
// Anthropic fallback removed: ANTHROPIC_API_KEY is restricted (all model names
// return 404). Primary path: upload last week's Excel → DUPLICATE mode (zero AI).
// CREATIVE mode uses Gemini only; if quota is exceeded the user gets a clear error.
async function callAI(prompt: string): Promise<{ raw: string; engine: string }> {
  try {
    const raw = await callGemini(prompt);
    return { raw, engine: "gemini" };
  } catch (err) {
    const msg = (err as Error).message;
    // Give the user an actionable message instead of a raw API error
    if (msg.includes("429") || msg.includes("quota")) {
      throw new Error(
        "gemini_quota_exceeded — מכסת ה-AI מוצתה. " +
        "העלה קובץ Excel עם הסידור של השבוע הקודם כדי לייצר סידור ללא AI (מהיר יותר ובחינם)."
      );
    }
    throw err;
  }
}

// ── Strip markdown fences and parse JSON array ────────────────────────────────
function parseScheduleJSON(raw: string): Array<Record<string, string>> {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const obj = JSON.parse(s);
  const arr = Array.isArray(obj) ? obj : (obj.schedule ?? []);
  if (!Array.isArray(arr)) throw new Error("model_returned_no_array");
  return arr;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Build prompt — DUPLICATOR mode ────────────────────────────────────────────
function buildDuplicatorPrompt(
  employeeProfiles: Array<Record<string, unknown>>,
  weekStart: string,
  constraints: string,
  department: string,
  memoryRules: string[],
  excelSchema: string,
): string {
  const rulesBlock = memoryRules.length
    ? `\nחוקים נוספים מהמנהל (מזיכרון הסוכן):\n${memoryRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`
    : "";

  const profilesJson = JSON.stringify(employeeProfiles, null, 2);

  return `אתה מחולל סידור משמרות עבור Dream Island Resort.
משימתך: **שכפל את הסידור הקודם לשבוע הבא** — שמור על אותם עובדים, אותן תחנות, אותן שעות.
שנה רק את **התאריכים** לשבוע: ${weekStart} (ראשון עד שבת).
${department ? `מחלקה: ${department}` : ""}
פורמט אקסל מקורי: ${excelSchema || "לא ידוע"}

════════ פרופיל עובדים שנלמד מהסידור הקודם ════════
${profilesJson}
════════════════════════════════════════════════════

${constraints && constraints.trim() ? `אילוצים חריגים לשבוע זה (חרוג מהדפוס רק עבורם):\n"${constraints}"\n` : ""}
${rulesBlock}

כללים נוקשים:
1. עבור כל עובד — שכפל כל יום עבודה מהשבוע הקודם לאותו יום בשבוע הבא (שמור יום בשבוע: ראשון→ראשון, שני→שני וכו').
2. שמור start/end בדיוק כפי שמופיע בפרופיל.
3. שמור station בדיוק.
4. אל תמציא עובדים חדשים.
5. אל תוסיף/תסיר ימי עבודה אלא אם צוין ב"אילוצים חריגים".

החזר JSON בלבד (ללא markdown, ללא הסברים):
{ "schedule": [
  { "employeeName": "...", "department": "...", "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "station": "...", "status": "עתידי" }
] }`;
}

// ── Build prompt — CREATIVE mode (fallback when no past data) ─────────────────
function buildCreativePrompt(
  employees: unknown,
  constraints: string,
  weekStart: string,
  department: string,
  memoryRules: string[],
  pastTemplates: Array<Record<string, string>> = [],
): string {
  const rulesBlock = memoryRules.length
    ? `\nכללים שנלמדו:\n${memoryRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`
    : "";

  // ── Few-shot: inject last 2 weeks of approved shifts as learning examples ──
  const fewShotBlock = pastTemplates.length > 0
    ? `\n══ PAST SUCCESSFUL TEMPLATES (Learn from these) ══\n` +
      `Replicate patterns from these schedules — same employee-station pairings, ` +
      `shift distributions, gap times between shifts, and coverage balance.\n` +
      JSON.stringify(pastTemplates.slice(0, 60), null, 2) +
      `\n══════════════════════════════════════════════════\n`
    : "";

  return `אתה אחראי משאבי אנוש ב-Dream Island Resort. צור סידור משמרות שבועי מאוזן.
שבוע: ${weekStart} (7 ימים). מחלקה: ${department || "כללי"}

עובדים: ${JSON.stringify(employees, null, 2)}
אילוצים: "${constraints || "אין"}"
${rulesBlock}${fewShotBlock}
כללים: 5 ימים לעובד / לא שתי משמרות ביום / כבד אילוצים / כל משמרת 8-10 שעות.

החזר JSON בלבד:
{ "schedule": [{ "employeeName":"...","department":"...","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","station":"","status":"עתידי" }] }`;
}

// ── DUPLICATE MODE: local schedule builder — no AI, deterministic ─────────────
// Takes pre-computed employee profiles (from ShiftGenerator.buildEmployeeProfiles)
// and shifts every workDay's date to the target week.
// Constraints / memory rules are applied as text annotations (not enforced by AI,
// but passed as notes so the manager can review).
function duplicateScheduleLocally(
  profiles:     Array<Record<string, unknown>>,
  weekStart:    string,
  department:   string,
  constraints:  string,
  _memoryRules: string[],
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];

  for (const profile of profiles) {
    const name     = String(profile.name ?? "");
    const workDays = (profile.workDays as Array<Record<string, unknown>>) ?? [];

    for (const wd of workDays) {
      const dayIndex = Number(wd.dayIndex ?? 0);

      // Compute the actual calendar date for this weekday in the target week
      const d = new Date(weekStart);
      d.setDate(d.getDate() + dayIndex);
      const date = d.toISOString().slice(0, 10);

      rows.push({
        employeeName: name,
        department:   department || String(profile.department ?? ""),
        date,
        start:        String(wd.start   ?? "08:00"),
        end:          String(wd.end     ?? "16:00"),
        station:      String(wd.station ?? ""),
        status:       "עתידי",
        notes:        constraints?.trim() ? `אילוץ: ${constraints.slice(0, 80)}` : "",
      });
    }
  }

  // Sort by date then employee name for clean display
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const {
      pastShifts = [],
      employees = [],
      constraints = "",
      weekStart,
      department = "",
      managerId,
      excelSchema = "",
      employeeProfiles = [],   // new: pre-computed rich profiles from ShiftGenerator
    } = body as {
      pastShifts: unknown[];
      employees: unknown[];
      constraints: string;
      weekStart: string;
      department: string;
      managerId?: string;
      excelSchema?: string;
      employeeProfiles?: Array<Record<string, unknown>>;
    };

    if (!weekStart) throw new Error("weekStart is required");

    // ── Single Supabase client for the entire request ─────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Load agent memory rules ───────────────────────────────────────────────
    let memoryRules: string[] = [];
    if (managerId && managerId !== "anonymous") {
      const { data: memories } = await supabase
        .from("agent_memory")
        .select("rule_text")
        .eq("manager_id", managerId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(15);
      if (memories?.length) {
        memoryRules = memories.map((m: { rule_text: string }) => m.rule_text);
        console.log("[generate-schedule] injecting", memoryRules.length, "memory rules");
      }
    }

    // ── Route: DUPLICATE (code) vs CREATIVE (AI) ─────────────────────────────
    const hasPastData = employeeProfiles.length > 0;
    console.log(`[generate-schedule] mode=${hasPastData ? "DUPLICATE(local)" : "CREATIVE(AI)"} profiles=${employeeProfiles.length} employees=${(employees as unknown[]).length}`);

    let schedule: Array<Record<string, string>>;
    let engine: string;

    if (hasPastData) {
      // ── DUPLICATE MODE: pure code, zero AI cost, 100% reliable ──────────────
      schedule = duplicateScheduleLocally(employeeProfiles, weekStart, department, constraints, memoryRules);
      engine   = "local-duplicate";

    } else {
      // ── CREATIVE MODE: few-shot learning → Gemini → Anthropic fallback ──────

      // Query last 2 weeks of approved shifts as few-shot learning templates
      let pastTemplates: Array<Record<string, string>> = [];
      try {
        const twoWeeksAgo = addDays(weekStart, -14);
        const { data: approvedShifts } = await supabase
          .from("shifts")
          .select("employeeName, date, start, end, station, department")
          .gte("date", twoWeeksAgo)
          .lt("date",  weekStart)
          .eq("department", department)
          .order("date", { ascending: true })
          .limit(80);
        if (approvedShifts?.length) {
          pastTemplates = approvedShifts as Array<Record<string, string>>;
          console.log(`[generate-schedule] few-shot: ${pastTemplates.length} approved shifts injected`);
        }
      } catch (e) {
        console.warn("[generate-schedule] few-shot query failed:", (e as Error).message);
      }

      const prompt = buildCreativePrompt(employees, constraints, weekStart, department, memoryRules, pastTemplates);
      const result  = await callAI(prompt);
      engine        = result.engine;
      schedule      = parseScheduleJSON(result.raw).map((s) => ({
        employeeName: s.employeeName ?? s.employee ?? "",
        department:   department || s.department || "",
        date:         s.date ?? weekStart,
        start:        s.start ?? "08:00",
        end:          s.end   ?? "16:00",
        station:      s.station ?? "",
        status:       "עתידי",
      }));
    }

    if (!schedule.length) throw new Error("schedule_empty — no shifts generated");

    // ── Persist learned patterns to DB (non-blocking) ────────────────────────
    if (managerId && managerId !== "anonymous" && hasPastData) {
      supabase.from("schedule_patterns").insert({
        manager_id:   managerId,
        department:   department || null,
        pattern_json: { employees: employeeProfiles, excelSchema },
        week_of:      weekStart,
      }).then(({ error: e }) => {
        if (e) console.warn("[generate-schedule] pattern save failed:", e.message);
      });
    }

    return new Response(
      JSON.stringify({ ok: true, engine, schedule, mode: hasPastData ? "duplicate" : "creative" }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-schedule] error:", msg);
    // ⚠️  Return HTTP 200 even on error so supabase-js populates `data`
    //     and the frontend receives the real error string, not a generic wrapper message.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
