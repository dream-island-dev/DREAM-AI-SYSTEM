// AI analysis + reply drafts for Orit Customer Service Agent.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import {
  isGenericLeadFormSubject,
  mergeTier0Category,
  tier0ClassifyOritThread,
  type Tier0OritHint,
} from "./oritAgentClassify.ts";
import {
  bodyHasComplaintSignal,
  shouldAnalyzeOritWithLlm,
  tier0ToAnalysisResult,
} from "./oritAgentAnalyzePolicy.ts";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";

const GEMINI_MODEL = "gemini-2.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-6";

const ORIT_VOICE_BLOCK = `
סגנון כתיבה של אורית חלפון (מנהלת שירות לאורח) — לתלונות:
• פתיחה אישית: «שלום רב [שם]», «תודה שפניתם אלינו ושיתפתם…»
• אמפתיה מיידית: «אנו מצרים לשמוע…», «תחושת אכזבה» — בלי להיות מתנשאת.
• גוף המכתב: פסקאות לפי נושא; «חשוב לנו להתייחס לנקודות שהעליתם»; עובדות מבדיקה («מבדיקתנו…», «לאחר בירור…»).
• כשאין דיווח בזמן אמת: «לא התקבלה פנייה בזמן אמת / לא הייתה לנו אפשרות לתת מענה מיידי» — רק אם מתאים לעובדות בפנייה.
• לא מבטיחים פיצוי כספי, הנחה או החזר שלא אושרו במפורש על ידי ההנהלה.
• סיום: «בברכה» או «יום נפלא», חתימה «אורית חלפון», «מנהלת שירות לאורח» (או «מנהלת קשרי לקוחות»).
`.trim();

const SYSTEM_PROMPT = `
אתה סוכן שירות לקוחות של דרים איילנד — אתר נופש יוקרתי. אורית חלפון היא מנהלת שירות לאורח.
תפקידך לנתח פניית מייל נכנסת (בעיקר תלונות) ולהכין טיוטות מענה בסגנון אורית.

חשוב מאוד:
• נושא המייל לעיתים קבוע מהאתר: «התקבלה פניה מלידים» — לא אומר שזה ליד! סווגי לפי גוף ההודעה.
• lead = עניין / מידע / הזמנה חדשה ללא תלונה. complaint = אכזבה, תלונה, פיצוי, חוויה שלילית.

${ORIT_VOICE_BLOCK}

הנחיות פלט:
• עברית בלבד.
• urgency: critical | high | normal | low
• urgency_reason: 1–2 משפטים לאורית.
• category: complaint | lead | booking | spa | vendor | internal | other
• summary: 2–3 שורות — שם האורח, מה קרה, בלי המצאות.
• ack_suggestion: אם category=complaint — מייל קצר (3–6 פסקאות) **בגוף ראשון כאילו אורית כותבת** (חתימה «אורית חלפון» בתחתית בלבד). אמפתיה + «קיבלנו את פנייתך» + הבטחת מענה («אבחן את הנושא ואיצור עמך קשר» / «ניצור איתך קשר בתוך 72 שעות»). **אסור** לכתוב על אורית בגוף שלישי («אורית חלפון תבחן», «מנהלת שירות לאורח, אורית חלפון, תיצור…») — זה נראה כאילו מישהו אחר כותב עליה. בלי פתרון מלא ובלי הבטחות כספיות.
• suggestions:
  - אם category=complaint: מכתב שלם אחד (8–18 פסקאות) בסגנון אורית, מבוסס על דגימות הסגנון. אפשר עד 2 וריאנטים במערך.
  - אחרת: עד 2 טיוטות קצרות.
• אל תמציא מחירים, שעות, החזרים או הבטחות שלא בפנייה.
• JSON בלבד: {"urgency":"...","urgency_reason":"...","category":"...","summary":"...","ack_suggestion":"...","suggestions":["..."]}
`.trim();

export type ThreadAnalysisInput = {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  bodyText: string;
  styleSamples: Array<{ inbound_snippet: string; outbound_text: string; context_category: string }>;
  draftCategory?: string;
};

export type ThreadAnalysisResult = {
  urgency: "critical" | "high" | "normal" | "low";
  urgency_reason: string;
  category: "complaint" | "lead" | "booking" | "spa" | "vendor" | "internal" | "other";
  summary: string;
  ackSuggestion?: string;
  suggestions: string[];
  engine: string;
};

const STYLE_SAMPLE_OUTBOUND_MAX = 2800;

function truncateStyleSample(text: string): string {
  const t = (text || "").trim();
  if (t.length <= STYLE_SAMPLE_OUTBOUND_MAX) return t;
  return `${t.slice(0, STYLE_SAMPLE_OUTBOUND_MAX)}\n[…]`;
}

function buildUserPrompt(input: ThreadAnalysisInput, tier0: Tier0OritHint | null): string {
  const isComplaintDraft = input.draftCategory === "complaint"
    || tier0?.category === "complaint"
    || bodyHasComplaintSignal(input.bodyText);

  const samples = input.styleSamples.slice(0, 6).map((s, i) =>
    `${i + 1}. קטגוריה: ${s.context_category}\n   נכנס: ${s.inbound_snippet}\n   נשלח: ${truncateStyleSample(s.outbound_text)}`,
  ).join("\n\n");

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
    samples ? `דגימות סגנון כתיבה של אורית (חקי את המבנה והטון):\n${samples}` : "",
    "",
    isComplaintDraft
      ? "זו תלונה — suggestions חייב לכלול מכתב מלא אחד לפחות בסגנון אורית (פסקאות מופרדות)."
      : "",
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
    ? obj.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, category === "complaint" ? 2 : 3)
    : [];

  return {
    urgency: (allowedUrgency.has(urgency) ? urgency : "normal") as ThreadAnalysisResult["urgency"],
    urgency_reason: String(obj.urgency_reason || "").trim() || "פנייה שדורשת בדיקה.",
    category: (allowedCategory.has(category) ? category : "other") as ThreadAnalysisResult["category"],
    summary: String(obj.summary || "").trim() || "פניית אורח לטיפול.",
    ackSuggestion: String(obj.ack_suggestion || obj.ackSuggestion || "").trim() || undefined,
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

async function callGemini(userPrompt: string, maxOutputTokens: number): Promise<string> {
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
          maxOutputTokens,
          temperature: 0.35,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(maxOutputTokens > 2000 ? 45000 : 25000),
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

async function callClaude(userPrompt: string, maxOutputTokens: number): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_claude_key");
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxOutputTokens,
    temperature: 0.35,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text : "";
}

export async function analyzeOritThread(
  input: ThreadAnalysisInput,
  _opts: { forceLlm?: boolean } = {},
): Promise<ThreadAnalysisResult> {
  const tier0 = tier0ClassifyOritThread(input.bodyText, input.subject);
  const userPrompt = buildUserPrompt(input, tier0);
  const isComplaintDraft = input.draftCategory === "complaint"
    || tier0?.category === "complaint"
    || bodyHasComplaintSignal(input.bodyText);
  const maxTokens = isComplaintDraft ? 4096 : 900;

  try {
    const raw = await callGemini(userPrompt, maxTokens);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...applyTier0Merge(parsed, tier0), engine: "gemini" };
  } catch (e) {
    console.warn("[oritAgentAi] gemini failed:", (e as Error).message);
  }

  try {
    const raw = await callClaude(userPrompt, maxTokens);
    const parsed = parseAnalysisJson(raw);
    if (parsed) return { ...applyTier0Merge(parsed, tier0), engine: "claude" };
  } catch (e) {
    console.warn("[oritAgentAi] claude failed:", (e as Error).message);
  }

  if (tier0) return tier0ToAnalysisResult(tier0);

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
    "היי אורית 💜",
    "כאן סיגל — סיכום הבוקר שלך.",
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
