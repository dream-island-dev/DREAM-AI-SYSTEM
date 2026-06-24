// supabase/functions/suggest-replies/index.ts
// Smart Inbox AI Copilot — Sprint 1 (No-Token Quick Replies → on-demand AI).
//
// Stateless: takes the last few messages of an ACTIVE conversation (already
// loaded client-side in WhatsAppInbox.js — no DB read here) + light guest
// context, and returns 3 short Hebrew reply options a staff member can pick
// from and send as-is. Only ever called when staff explicitly clicks
// "✨ הצעות AI חכמות" — never on chat selection (token-saving by design).
//
// Same Gemini→Claude fallback shape as supabase/functions/chat/index.ts,
// deliberately not shared via a _shared/ helper — this function has no
// history persistence, no Drive RAG, no memory; sharing would mean importing
// unused machinery for a one-shot generation call.
//
// Required Supabase secrets: GEMINI_API_KEY and/or ANTHROPIC_API_KEY.

import { serve }   from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic   from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-6";

// Same warm-luxury persona as the guest-facing bot (whatsapp-webhook's
// LUXURY_CONCIERGE_PERSONA_SUFFIX) — these are drafts a staff member sends
// AS the concierge, so the tone must match what the guest already expects.
const SYSTEM_PROMPT = `
את/ה כותב/ת טיוטות תגובה עבור צוות הקבלה של Dream Island — אחד מאתרי הנופש היוקרתיים בישראל — לשליחה ידנית לאורח/ת בוואטסאפ.

הנחיות:
• עברית בלבד, חמה וטבעית — כמו מנהל/ת אירוח אנושי שמכיר את האורח, לא נציג שירות רשמי או רובוטי. קליל, קצר ומדויק.
• כל הצעה מתייחסת ישירות להודעות האחרונות בשיחה שצורפו — לא תגובה גנרית שמתאימה לכל שיחה.
• לעולם אל תמציא/י פרטים (מחיר, שעה, חדר, הבטחה) שלא נמסרו לך בהקשר. אם המידע חסר — נסח/י תגובה שמבטיחה בדיקה/חזרה ולא תשובה מסוימת.
• החזר/י **רק** JSON תקין בצורה: {"suggestions": ["...", "...", "..."]} — עד 3 הצעות, כל אחת משפט-שניים קצרים. בלי טקסט נוסף, בלי הסבר, בלי markdown code fences.
`.trim();

type ThreadMsg = { direction: "inbound" | "outbound"; text: string };

function buildUserPrompt(messages: ThreadMsg[], guestName: string | null, room: string | null): string {
  const convo = messages
    .map((m) => `${m.direction === "inbound" ? "אורח" : "צוות/בוט"}: ${m.text}`)
    .join("\n");
  return [
    `שם האורח: ${guestName || "לא ידוע"}`,
    `חדר/סוויטה: ${room || "לא ידוע"}`,
    "",
    "ההודעות האחרונות בשיחה (מהישנה לחדשה):",
    convo || "(אין הודעות עדיין)",
    "",
    "נסח/י עד 3 הצעות תגובה קצרות לצוות לבחירה.",
  ].join("\n");
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no_gemini_key");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.8, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini_http_${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("") ?? "";
  if (!text.trim()) throw new Error("gemini_empty_response");
  return text;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return resp.content[0].type === "text" ? resp.content[0].text : "";
}

// Defensive parsing — strips markdown fences if the model added them anyway,
// then falls back to extracting the first {...} substring, then to a
// best-effort line-split. Never throws; returns [] if nothing usable found,
// so the caller can show a clear error instead of crashing on malformed AI output.
function parseSuggestions(raw: string): string[] {
  const stripped = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const tryParse = (s: string): string[] | null => {
    try {
      const obj = JSON.parse(s);
      if (Array.isArray(obj?.suggestions)) {
        return obj.suggestions.filter((s: unknown) => typeof s === "string" && s.trim()).slice(0, 3);
      }
    } catch { /* fall through */ }
    return null;
  };

  let result = tryParse(stripped);
  if (!result) {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) result = tryParse(match[0]);
  }
  if (!result) {
    result = stripped.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 3);
  }
  return result ?? [];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { messages, guestName, room } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages array required");
    }

    const last3 = messages.slice(-3) as ThreadMsg[];
    const userPrompt = buildUserPrompt(last3, guestName ?? null, room ?? null);

    let raw: string;
    let engine: "gemini" | "claude";
    if (Deno.env.get("GEMINI_API_KEY")) {
      try {
        raw = await callGemini(SYSTEM_PROMPT, userPrompt);
        engine = "gemini";
      } catch (e) {
        console.error("[suggest-replies] Gemini failed → falling back to Claude:", (e as Error).message);
        raw = await callClaude(SYSTEM_PROMPT, userPrompt);
        engine = "claude";
      }
    } else {
      raw = await callClaude(SYSTEM_PROMPT, userPrompt);
      engine = "claude";
    }

    const suggestions = parseSuggestions(raw);
    if (suggestions.length === 0) throw new Error("ai_returned_no_usable_suggestions");

    return new Response(
      JSON.stringify({ ok: true, suggestions, engine }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[suggest-replies] error:", raw);

    let userError = raw;
    if (raw === "no_gemini_key" || raw === "no_anthropic_key") {
      userError = "לא הוגדר מפתח AI ב-Supabase Secrets.";
    } else if (raw.includes("gemini_http_429") || raw.includes("quota")) {
      userError = "מכסת ה-AI מוצתה כרגע — נסה/י שוב בעוד רגע.";
    } else if (raw === "ai_returned_no_usable_suggestions") {
      userError = "ה-AI לא הצליח להפיק הצעות תקינות — נסה/י שוב.";
    }

    // Always HTTP 200, error in body — same convention as every other
    // function in this project (chat/whatsapp-send/etc.), so supabase-js
    // never swallows the real reason behind a generic non-2xx wrapper.
    return new Response(
      JSON.stringify({ ok: false, error: userError }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
