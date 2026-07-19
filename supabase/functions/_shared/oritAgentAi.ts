// AI analysis + reply drafts for Orit Customer Service Agent.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import {
  isGenericLeadFormSubject,
  mergeTier0Category,
  tier0ClassifyOritThread,
  type Tier0OritHint,
} from "./oritAgentClassify.ts";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";

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
  category: "complaint" | "lead" | "booking" | "spa" | "vendor" | "internal" | "other";
  summary: string;
  suggestions: string[];
  engine: string;
};

const SYSTEM_PROMPT = `
אתה סוכן שירות לקוחות של דרים איילנד — אתר נופש יוקרתי בבעלות אורית.
תפקידך לנתח פניית מייל נכנסת ולעזור לאורית לנהל שירות לקוחות בנוחות.

חשוב מאוד:
• נושא המייל לעיתים קרובות קבוע מהאתר: «התקבלה פניה מלידים» — זה לא אומר שזה ליד!
  סווגי לפי תוכן גוף ההודעה בלבד. תלונה ארוכה עם מילים כמו תלונה/אכזבה/פיצוי = complaint.
• lead = פניית עניין / בקשת מידע / הזמנה חדשה ללא תלונה.
• complaint = תלונה, אכזבה, בקשת פיצוי, חוויה שלילית — דחיפות high או critical.
• booking = הזמנת לינה קיימת / שינוי הזמנה (לא תלונה).

הנחיות:
• עברית בלבד בכל השדות הטקסטואליים.
• urgency: critical | high | normal | low
• urgency_reason: 1–2 משפטים שמסבירים לאורית למה זה דחוף/לא.
• category: complaint | lead | booking | spa | vendor | internal | other
• summary: 2–3 שורות — שם האורח (אם מופיע), מה הוא רוצה, בלי המצאות.
• suggestions: עד 3 טיוטות תשובה קצרות.
  - complaint: טון מתנצל ואמפתי, בלי הבטחות פיצוי שלא מופיעות בפנייה.
  - lead/booking: טון חם ומזמין.
• לעולם אל תמציא מחירים, שעות, הבטחות או אישורי ביטול שלא מופיעים בפנייה.
• החזר JSON בלבד: {"urgency":"...","urgency_reason":"...","category":"...","summary":"...","suggestions":["...","...","..."]}
`.trim();

function buildUserPrompt(input: ThreadAnalysisInput, tier0: Tier0OritHint | null): string {
  const samples = input.styleSamples.slice(0, 8).map((s, i) =>
    `${i + 1}. קטגוריה: ${s.context_category}\n   נכנס: ${s.inbound_snippet}\n   נשלח: ${s.outbound_text}`
  ).join("\n");

  const genericSubject = isGenericLeadFormSubject(input.subject);

  return [
    genericSubject
      ? `נושא המייל (קבוע מהאתר — התעלמי ממנו לסיווג): ${input.subject}`
      : `נושא: ${input.subject || "(ללא נושא)"}`,
    `שולח: ${input.fromName || "לא ידוע"} <${input.fromEmail}>`,
    tier0 ? `רמז סיווג מקדים (מילות מפתח): ${tier0.category} — ${tier0.urgency_reason}` : "",
    "",
    "תוכן הפנייה (מקור האמת לסיווג):",
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
  const allowedCategory = new Set(["complaint", "lead", "booking", "spa", "vendor", "internal", "other"]);
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

function applyTier0Merge(parsed: ThreadAnalysisResult, tier0: Tier0OritHint | null): ThreadAnalysisResult {
  if (!tier0) return parsed;
  const merged = mergeTier0Category(tier0, parsed.category, parsed.urgency);
  const urgency_reason = merged.category === "complaint" && tier0.category === "complaint"
    ? (parsed.urgency_reason.includes("ידנית") ? tier0.urgency_reason : parsed.urgency_reason)
    : parsed.urgency_reason;
  return {
    ...parsed,
    category: merged.category,
    urgency: merged.urgency,
    urgency_reason,
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
          temperature: 0.35,
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
    temperature: 0.35,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text : "";
}

export async function analyzeOritThread(input: ThreadAnalysisInput): Promise<ThreadAnalysisResult> {
  const tier0 = tier0ClassifyOritThread(input.bodyText, input.subject);
  const userPrompt = buildUserPrompt(input, tier0);

  try {
    const raw = await callGemini(userPrompt);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...applyTier0Merge(parsed, tier0), engine: "gemini" };
  } catch (e) {
    console.warn("[oritAgentAi] gemini failed:", (e as Error).message);
  }

  try {
    const raw = await callClaude(userPrompt);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...applyTier0Merge(parsed, tier0), engine: "claude" };
  } catch (e) {
    console.warn("[oritAgentAi] claude failed:", (e as Error).message);
  }

  if (tier0) {
    return {
      urgency: tier0.urgency,
      urgency_reason: tier0.urgency_reason,
      category: tier0.category,
      summary: tier0.summary,
      suggestions: tier0.suggestions,
      engine: "tier0",
    };
  }

  return {
    urgency: "normal",
    urgency_reason: "לא ניתן לנתח אוטומטית — נדרשת בדיקה ידנית.",
    category: isGenericLeadFormSubject(input.subject) ? "lead" : "other",
    summary: input.bodyText.slice(0, 280) || input.subject || "פניית אורח.",
    suggestions: [
      "שלום, קיבלנו את בקשתך, ניצור איתך קשר בהקדם.",
    ],
    engine: "fallback",
  };
}


export type MorningDigestComplaintRow = {
  id: string;
  subject: string;
  from_name: string | null;
  guest_contact_name?: string | null;
  urgency: string;
  ai_summary: string | null;
  hours_over?: number;
  hours_left?: number;
  overdue: boolean;
};

function morningGuestLabel(row: MorningDigestComplaintRow): string {
  const name = row.guest_contact_name?.trim() || row.from_name?.trim();
  if (name && !name.includes("@")) return name;
  return "אורח";
}

function morningUrgencyEmoji(urgency: string): string {
  if (urgency === "critical") return "🔴";
  if (urgency === "high") return "🟠";
  return "🟡";
}

export async function composeMorningDigestBullet(data: {
  openComplaints: MorningDigestComplaintRow[];
  leadsLast24h: number;
  otherOpenCount: number;
  handledYesterday: number;
}): Promise<string> {
  const lines: string[] = [
    "🌅 בוקר טוב אורית — סיגל",
    `📅 ${new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`,
    "",
    `📈 לידים ב-24 שעות האחרונות: ${data.leadsLast24h}`,
    "",
  ];

  if (data.openComplaints.length) {
    lines.push(`😤 תלונות פתוחות לטיפול (${data.openComplaints.length}):`);
    for (const row of data.openComplaints.slice(0, 6)) {
      const sla = row.overdue
        ? `(עבר SLA · ${row.hours_over}ש')`
        : row.hours_left != null
          ? `(נשארו ${row.hours_left}ש')`
          : "";
      const summary = (row.ai_summary || row.subject || "").split("\n")[0].slice(0, 90);
      lines.push(
        `${morningUrgencyEmoji(row.urgency)} ${morningGuestLabel(row)} ${sla}`,
        `   ${summary}`,
        `   ${buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: row.id })}`,
      );
    }
    lines.push("");
  } else {
    lines.push("✅ אין תלונות פתוחות — יופי!");
    lines.push("");
  }

  if (data.otherOpenCount > 0) {
    lines.push(`📬 פניות אחרות פתוחות (לא תלונה): ${data.otherOpenCount}`);
    lines.push("");
  }

  lines.push(`✅ טופל אתמול: ${data.handledYesterday}`);
  lines.push("");
  lines.push("▶️ לכל התיבה:");
  lines.push(buildStaffAppDeepLink({ page: "orit_cs_agent" }));

  return lines.join("\n");
}
