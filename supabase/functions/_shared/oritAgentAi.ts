// AI analysis + reply drafts for Orit Customer Service Agent.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const GEMINI_MODEL = "gemini-2.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-6";

export type ThreadAnalysisInput = {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  bodyText: string;
  styleSamples: Array<{ inbound_snippet: string; outbound_text: string; context_category: string }>;
};

export type ThreadAnalysisResult = {
  urgency: "critical" | "high" | "normal" | "low";
  urgency_reason: string;
  category: "complaint" | "booking" | "spa" | "vendor" | "internal" | "other";
  summary: string;
  suggestions: string[];
  engine: string;
};

const SYSTEM_PROMPT = `
אתה סוכן שירות לקוחות של דרים איילנד — אתר נופש יוקרתי בבעלות אורית.
תפקידך לנתח פניית מייל נכנסת ולעזור לאורית לנהל שירות לקוחות בנוחות.

הנחיות:
• עברית בלבד בכל השדות הטקסטואליים.
• urgency: critical | high | normal | low — לפי חומרת הפנייה לשירות הלקוחות.
• urgency_reason: 1–2 משפטים שמסבירים לאורית למה זה דחוף/לא.
• category: complaint | booking | spa | vendor | internal | other
• summary: 2–3 שורות — מה האורח רוצה, בלי המצאות.
• suggestions: עד 3 טיוטות תשובה קצרות, חמות ומקצועיות, בשפה אחידה.
• לעולם אל תמציא מחירים, שעות, הבטחות או אישורי ביטול שלא מופיעים בפנייה.
• החזר JSON בלבד: {"urgency":"...","urgency_reason":"...","category":"...","summary":"...","suggestions":["...","...","..."]}
`.trim();

function buildUserPrompt(input: ThreadAnalysisInput): string {
  const samples = input.styleSamples.slice(0, 8).map((s, i) =>
    `${i + 1}. קטגוריה: ${s.context_category}\n   נכנס: ${s.inbound_snippet}\n   נשלח: ${s.outbound_text}`
  ).join("\n");

  return [
    `נושא: ${input.subject || "(ללא נושא)"}`,
    `שולח: ${input.fromName || "לא ידוע"} <${input.fromEmail}>`,
    "",
    "תוכן הפנייה:",
    input.bodyText.slice(0, 4000) || "(ריק)",
    "",
    samples ? `דגימות סגנון אחרונות של אורית:\n${samples}` : "",
    "",
    "נתח והחזר JSON בלבד.",
  ].filter(Boolean).join("\n");
}

function parseAnalysisJson(raw: string): ThreadAnalysisResult | null {
  try {
    const direct = JSON.parse(raw.trim());
    return normalizeAnalysis(direct);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return normalizeAnalysis(JSON.parse(m[0]));
    } catch {
      return null;
    }
  }
}

function normalizeAnalysis(obj: Record<string, unknown>): ThreadAnalysisResult | null {
  const urgency = String(obj.urgency || "normal");
  const category = String(obj.category || "other");
  const allowedUrgency = new Set(["critical", "high", "normal", "low"]);
  const allowedCategory = new Set(["complaint", "booking", "spa", "vendor", "internal", "other"]);
  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
    : [];

  return {
    urgency: (allowedUrgency.has(urgency) ? urgency : "normal") as ThreadAnalysisResult["urgency"],
    urgency_reason: String(obj.urgency_reason || "").trim() || "פנייה שדורשת בדיקה.",
    category: (allowedCategory.has(category) ? category : "other") as ThreadAnalysisResult["category"],
    summary: String(obj.summary || "").trim() || "פניית אורח לטיפול.",
    suggestions: suggestions.length ? suggestions : ["שלום, קיבלנו את פנייתך ונחזור אליך בהקדם. תודה על סבלנותך."],
    engine: "parsed",
  };
}

async function callGemini(userPrompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no_gemini_key");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: 900,
          temperature: 0.4,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(25000),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini_http_${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === "string");
  return textPart?.text ?? "";
}

async function callClaude(userPrompt: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_claude_key");
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 900,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text : "";
}

export async function analyzeOritThread(input: ThreadAnalysisInput): Promise<ThreadAnalysisResult> {
  const userPrompt = buildUserPrompt(input);

  try {
    const raw = await callGemini(userPrompt);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...parsed, engine: "gemini" };
  } catch (e) {
    console.warn("[oritAgentAi] gemini failed:", (e as Error).message);
  }

  try {
    const raw = await callClaude(userPrompt);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...parsed, engine: "claude" };
  } catch (e) {
    console.warn("[oritAgentAi] claude failed:", (e as Error).message);
  }

  return {
    urgency: "normal",
    urgency_reason: "לא ניתן לנתח אוטומטית — נדרשת בדיקה ידנית.",
    category: "other",
    summary: input.bodyText.slice(0, 280) || input.subject || "פניית אורח.",
    suggestions: [
      "שלום, תודה על פנייתך. קיבלנו את ההודעה ונחזור אליך בהקדם.",
    ],
    engine: "fallback",
  };
}

export async function composeMorningDigestBullet(data: {
  overdue: Array<{ subject: string; from_name: string | null; hours_over: number }>;
  waiting: Array<{ subject: string; from_name: string | null; hours_left: number }>;
  handledYesterday: number;
  newYesterday: number;
}): Promise<string> {
  const lines: string[] = [
    "🌅 סיכום שירות לקוחות — דרים איילנד",
    `📅 ${new Date().toLocaleDateString("he-IL")}`,
    "",
  ];

  if (data.overdue.length) {
    lines.push(`🔴 עבר SLA / דחוף (${data.overdue.length}):`);
    for (const row of data.overdue.slice(0, 5)) {
      lines.push(`• ${row.from_name || "אורח"} — ${row.subject} (עברו ${row.hours_over}ש')`);
    }
    lines.push("");
  }

  if (data.waiting.length) {
    lines.push(`🟠 ממתין לתשובתך (${data.waiting.length}):`);
    for (const row of data.waiting.slice(0, 5)) {
      lines.push(`• ${row.from_name || "אורח"} — ${row.subject} (נשארו ${row.hours_left}ש')`);
    }
    lines.push("");
  }

  lines.push(`✅ טופל אתמול: ${data.handledYesterday}`);
  lines.push(`📥 פניות חדשות אתמול: ${data.newYesterday}`);
  lines.push("");
  lines.push("🔗 dream-ai-system.vercel.app");

  return lines.join("\n");
}
