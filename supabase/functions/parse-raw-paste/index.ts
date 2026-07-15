// supabase/functions/parse-raw-paste/index.ts
// Smart Paste — Gemini 2.5 Flash structured extraction from raw EZGO/email/spa text.
// Never writes to DB; frontend runs match_guest_fuzzy + human approval before upsert.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_RAW_CHARS = 48_000;

type GuestType = "suite_guest" | "day_guest";
type MealPlan = "none" | "dinner_only" | "half_board" | "full_board";

type RawCandidate = {
  guest_name?: string | null;
  phone_raw?: string | null;
  order_number?: string | null;
  arrival_date?: string | null;
  meal_plan?: string | null;
  meal_plan_label?: string | null;
  spa_date?: string | null;
  spa_time?: string | null;
  room_count?: number | null;
  guest_count?: number | null;
  guest_type?: string | null;
  guest_type_reason?: string | null;
  package_label?: string | null;
  confidence?: number | null;
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    source_format: {
      type: "STRING",
      enum: ["ezgo_daily_report", "spa_schedule", "email", "mixed", "unknown"],
    },
    context_date: { type: "STRING", nullable: true },
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          guest_name: { type: "STRING", nullable: true },
          phone_raw: { type: "STRING", nullable: true },
          order_number: { type: "STRING", nullable: true },
          arrival_date: { type: "STRING", nullable: true },
          meal_plan: {
            type: "STRING",
            enum: ["none", "dinner_only", "half_board", "full_board"],
            nullable: true,
          },
          meal_plan_label: { type: "STRING", nullable: true },
          spa_date: { type: "STRING", nullable: true },
          spa_time: { type: "STRING", nullable: true },
          room_count: { type: "INTEGER", nullable: true },
          guest_count: { type: "INTEGER", nullable: true },
          guest_type: { type: "STRING", enum: ["suite_guest", "day_guest"] },
          guest_type_reason: { type: "STRING" },
          package_label: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["guest_type", "guest_type_reason", "confidence"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    unparsed_lines: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["source_format", "candidates", "warnings", "unparsed_lines"],
};

function buildPrompt(rawText: string, contextDate: string | null): string {
  const dateHint = contextDate
    ? `תאריך הקשר שסופק ע"י הצוות: ${contextDate}. השתמש בו כ-arrival_date/spa_date כשהטקסט לא מציין תאריך במפורש.\n\n`
    : "";

  return `${dateHint}אתה מנתח טקסט גולמי ממערכת EZGO, מיילים, או לוח ספא של מלון יוקרה בישראל (דרים איילנד).
חלץ כל אורח/הזמנה שניתן לזהות כמועמד נפרד.

כללי סיווג guest_type (חובה לכל מועמד):
• "suite_guest" — לינה בסוויטה / אורח לילה: מזוהים BB, HB, FB, חצי פנסיון, פנסיון מלא, טיפולי ספא לדיירי סוויטות, מספר לילות, צ'ק-אין לסוויטה.
• "day_guest" — בילוי יומי בלבד: קלאסיק, דלאקס, Premium Day, ארוחת צהריים בלבד, חבילת יום, בלי לינה.

מיפוי פנסיון ל-meal_plan:
• FB / פנסיון מלא → full_board
• HB / חצי פנסיון → half_board
• BB / ארוחת בוקר (עם לינה) → half_board
• ארוחת ערב בלבד / dinner only → dinner_only
• ללא פנסיון → none
שמור את הקיצור המקורי ב-meal_plan_label (למשל "HB").

שעות: spa_time בפורמט HH:MM (24h). תאריכים: YYYY-MM-DD.
טלפון: שמור כפי שמופיע (phone_raw) — אל תוסיף +972 בכוח.
אם אין שם — אל תמציא מועמד. confidence 0.0–1.0 לפי ודאות החילוץ.

הטקסט לניתוח:
"""
${rawText.slice(0, MAX_RAW_CHARS)}
"""`;
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?[\r\n]*/i, "")
    .replace(/[\r\n]*```$/i, "")
    .trim();
}

function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error("invalid_json_response");
  }
}

const MEAL_PLANS = new Set(["none", "dinner_only", "half_board", "full_board"]);

function normalizeMealPlan(v: unknown): MealPlan | null {
  const s = String(v ?? "").trim().toLowerCase();
  return MEAL_PLANS.has(s) ? (s as MealPlan) : null;
}

function normalizeGuestType(v: unknown): GuestType {
  return String(v ?? "").trim() === "day_guest" ? "day_guest" : "suite_guest";
}

function normalizeDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeTime(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function normalizeCandidate(raw: RawCandidate, idx: number) {
  const guestType = normalizeGuestType(raw.guest_type);
  const name = String(raw.guest_name ?? "").trim() || null;
  const conf = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.5;

  return {
    id: `paste-${idx + 1}`,
    guest_name: name,
    phone_raw: String(raw.phone_raw ?? "").trim() || null,
    order_number: String(raw.order_number ?? "").trim() || null,
    arrival_date: normalizeDate(raw.arrival_date),
    meal_plan: normalizeMealPlan(raw.meal_plan),
    meal_plan_label: String(raw.meal_plan_label ?? "").trim() || null,
    spa_date: normalizeDate(raw.spa_date),
    spa_time: normalizeTime(raw.spa_time),
    room_count: typeof raw.room_count === "number" && raw.room_count > 0
      ? Math.round(raw.room_count)
      : null,
    guest_count: typeof raw.guest_count === "number" && raw.guest_count > 0
      ? Math.round(raw.guest_count)
      : null,
    guest_type: guestType,
    guest_type_reason: String(raw.guest_type_reason ?? "").trim()
      || (guestType === "day_guest" ? "סווג כבילוי יומי" : "סווג כאורח סוויטה"),
    package_label: String(raw.package_label ?? "").trim() || null,
    confidence: conf,
  };
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("no_gemini_key");

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`gemini_${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{
    thought?: boolean;
    text?: string;
  }>;
  const realPart = parts.find((p) => !p.thought && typeof p.text === "string");
  const text = (realPart?.text ?? "").trim();
  if (!text) throw new Error("gemini_empty_response");
  return text;
}

async function authenticate(req: Request): Promise<void> {
  const bearer = req.headers.get("Authorization") ?? "";
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("unauthorized");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("unauthorized");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    await authenticate(req);

    const body = await req.json() as {
      raw_text?: unknown;
      context_date?: unknown;
    };

    const rawText = String(body.raw_text ?? "").trim();
    if (!rawText) throw new Error("missing_raw_text");
    if (rawText.length > MAX_RAW_CHARS) {
      throw new Error(`raw_text_too_long: max ${MAX_RAW_CHARS} chars`);
    }

    const contextDate = normalizeDate(body.context_date);

    const prompt = buildPrompt(rawText, contextDate);
    const rawJson = await callGemini(prompt);
    const parsed = parseModelJson(rawJson) as {
      source_format?: string;
      context_date?: string | null;
      candidates?: RawCandidate[];
      warnings?: string[];
      unparsed_lines?: string[];
    };

    const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
      .map((c, i) => normalizeCandidate(c, i))
      .filter((c) => c.guest_name || c.phone_raw || c.order_number);

    const sourceFormat = String(parsed.source_format ?? "unknown");
    const allowedFormats = new Set([
      "ezgo_daily_report", "spa_schedule", "email", "mixed", "unknown",
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        engine: GEMINI_MODEL,
        source_format: allowedFormats.has(sourceFormat) ? sourceFormat : "unknown",
        context_date: contextDate ?? normalizeDate(parsed.context_date),
        candidates,
        warnings: Array.isArray(parsed.warnings)
          ? parsed.warnings.map((w) => String(w)).filter(Boolean)
          : [],
        unparsed_lines: Array.isArray(parsed.unparsed_lines)
          ? parsed.unparsed_lines.map((l) => String(l)).filter(Boolean).slice(0, 20)
          : [],
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[parse-raw-paste] error:", raw);

    let userError = raw;
    if (raw.includes("no_gemini_key")) {
      userError = "לא הוגדר GEMINI_API_KEY ב-Supabase Secrets.";
    } else if (raw.includes("unauthorized")) {
      userError = "נדרשת התחברות לצוות.";
    } else if (raw.includes("invalid_json_response")) {
      userError = "המודל החזיר JSON לא תקין — נסה שוב או קצר את הטקסט.";
    } else if (raw.includes("gemini_429") || raw.includes("quota")) {
      userError = "מכסת Gemini מוצתה — נסה שוב בעוד דקה.";
    }

    return new Response(
      JSON.stringify({ ok: false, error: userError }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
