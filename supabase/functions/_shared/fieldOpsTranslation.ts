// Shared Hebrew→English translation for Whapi ops-group cards only.
// DB task.description stays Hebrew — callers pass translated text only to sendWhapiText.

const HEBREW_RE = /[\u0590-\u05FF]/;

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const GEMINI_MODELS: string[] = (Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const CLAUDE_MODEL_FOR_TRANSLATION = "claude-haiku-4-5";
const TRANSLATE_MAX_OUTPUT_TOKENS = 1024;

/** Inbox routeTask prefix — Hebrew label for the board; not for the English field card. */
const INBOX_ROUTE_PREFIX_RE = /^\[מתיבת וואטסאפ\s*[—–-]\s*[^\]]*\]\s*/u;

export function containsHebrew(text: string): boolean {
  return HEBREW_RE.test(text);
}

/** Strip `[מתיבת וואטסאפ — Guest] ` so Gemini translates the request only. */
export function stripInboxRoutePrefix(text: string): string {
  return text.replace(INBOX_ROUTE_PREFIX_RE, "").trim();
}

/** Dangling English function-word = MAX_TOKENS / incomplete line (e.g. "…toothbrushes and"). */
export function looksTruncatedFieldOpsEnglish(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /\b(and|or|the|to|of|with|for|a|an)\s*[,:;]?\s*$/i.test(t);
}

const DENTAL_ITEM_RE =
  /משחת\s*שיניים|מברש(?:ת|ות)?\s*שיניים|\btooth\s*pastes?\b|\btoothpastes?\b|\btooth\s*brushes?\b|\btoothbrushes?\b|\bdental\s*kit\b/gi;

const FIELD_OPS_GLOSSARY =
  `House kit names (use these, do not itemize): ` +
  `toothbrush / toothpaste / משחת שיניים / מברשת שיניים → DENTAL KIT. ` +
  `If quantity is 2+, write "N x DENTAL KIT".`;

/** Collapse toothbrush/toothpaste wording to the field term DENTAL KIT. */
export function applyFieldOpsKitTerms(english: string): string {
  DENTAL_ITEM_RE.lastIndex = 0;
  if (!DENTAL_ITEM_RE.test(english)) return english.trim();
  DENTAL_ITEM_RE.lastIndex = 0;
  const qtyMatch = english.match(/\b(\d{1,2})\s*(?:x\s*)?(?:tooth|dental|DENTAL)/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
  const kit = qty >= 2 ? `${qty} x DENTAL KIT` : "DENTAL KIT";
  let t = english.replace(DENTAL_ITEM_RE, "DENTAL KIT");
  t = t.replace(/(?:DENTAL KIT)(?:\s*(?:,|&|and|\/|\+)\s*DENTAL KIT)+/gi, "DENTAL KIT");
  t = t.replace(/\b\d{1,2}\s+(?=DENTAL KIT)/i, "");
  t = t.replace(/\bDENTAL KIT\b/i, kit);
  t = t.replace(/\s+\b(and|or|&)\s*$/i, "");
  return t.replace(/\s+/g, " ").trim();
}

function isDentalKitOnlyRequest(source: string): boolean {
  DENTAL_ITEM_RE.lastIndex = 0;
  if (!DENTAL_ITEM_RE.test(source)) return false;
  DENTAL_ITEM_RE.lastIndex = 0;
  const leftover = source
    .replace(DENTAL_ITEM_RE, " ")
    .replace(/שירותי\s*נוחות/g, " ")
    .replace(/\b(please|bring|deliver|need|and|or|the|to|of|with|for)\b/gi, " ")
    .replace(/בבקשה|תביאו|תביא|להביא|צריך|חסר|עוד/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^\u0590-\u05FFa-zA-Z]/g, " ")
    .replace(/[ושלםבכל]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return leftover.length === 0;
}

export type FieldOpsTranslateStyle = "description_only" | "room_dash_line";

function geminiGenerationConfig(model: string, includeThinkingOff: boolean) {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    candidateCount: 1,
  };
  if (includeThinkingOff && /2\.5|gemini-3/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  return generationConfig;
}

export async function translateTextForFieldOps(
  text: string,
  opts?: { room?: string | null; style?: FieldOpsTranslateStyle },
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const source = stripInboxRoutePrefix(trimmed) || trimmed;
  const roomLabel = opts?.room?.trim() || "—";
  const style = opts?.style ?? "description_only";
  const wrap = (line: string) => (style === "room_dash_line" ? `Room ${roomLabel} - ${line}` : line);

  if (isDentalKitOnlyRequest(source)) {
    const qty = Number(source.match(/(\d{1,2})\s*(?:x\s*)?(?:מברש|משחת|tooth|dental)/i)?.[1] ?? 1);
    return wrap(qty >= 2 ? `${qty} x DENTAL KIT` : "DENTAL KIT");
  }
  if (!containsHebrew(source)) return applyFieldOpsKitTerms(source);

  const prompt = style === "room_dash_line"
    ? `Translate this Hebrew in-suite hotel guest service request into one complete professional English line for field staff. ` +
      `Format exactly: "Room ${roomLabel} - <request in English>". Output ONLY that single English line. ` +
      `${FIELD_OPS_GLOSSARY} Do not stop mid-list or after "and". Ignore inbox/source labels.\n\n` +
      `Hebrew: ${source}`
    : `Translate this Hebrew hotel operations task description into complete professional English for field staff. ` +
      `Output ONLY the English translation — one line, no quotes, no Hebrew, no room prefix, no inbox label. ` +
      `${FIELD_OPS_GLOSSARY} Do not stop mid-list or after "and".\n\n` +
      `Staff task (Hebrew): ${source}`;

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.warn("[fieldOpsTranslation] GEMINI_API_KEY unset — trying Claude fallback");
  } else {
    for (const model of GEMINI_MODELS.slice(0, 2)) {
      const translated = await tryGeminiTranslate(apiKey, model, prompt, true)
        ?? await tryGeminiTranslate(apiKey, model, prompt, false);
      if (translated) return applyFieldOpsKitTerms(translated);
    }
  }

  const claudeTranslated = await translateViaClaudeFallback(prompt);
  if (claudeTranslated) {
    console.info("[fieldOpsTranslation] Claude fallback succeeded");
    return applyFieldOpsKitTerms(claudeTranslated);
  }

  console.warn("[fieldOpsTranslation] all engines (Gemini + Claude) failed — Whapi fallback keeps Hebrew");
  return style === "room_dash_line" ? `Room ${roomLabel} - ${source}` : source;
}

async function tryGeminiTranslate(
  apiKey: string,
  model: string,
  prompt: string,
  includeThinkingOff: boolean,
): Promise<string | null> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: geminiGenerationConfig(model, includeThinkingOff),
  });
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20000) },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[fieldOpsTranslation] Gemini ${model} ${res.status} thinkingOff=${includeThinkingOff}`);
      return null;
    }
    const data = await res.json();
    const finishReason = String(data?.candidates?.[0]?.finishReason ?? "");
    if (finishReason === "MAX_TOKENS") {
      console.warn(`[fieldOpsTranslation] Gemini ${model} finishReason=MAX_TOKENS — rejecting truncated line`);
      return null;
    }
    const rawParts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>;
    const translated = (rawParts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "").trim()
      .replace(/^["']|["']$/g, "");
    if (!translated || containsHebrew(translated) || looksTruncatedFieldOpsEnglish(translated)) {
      if (translated && looksTruncatedFieldOpsEnglish(translated)) {
        console.warn(`[fieldOpsTranslation] Gemini ${model} dangling English — rejecting: ${translated}`);
      }
      return null;
    }
    return translated;
  } catch (e) {
    console.warn(`[fieldOpsTranslation] Gemini ${model} failed:`, (e as Error).message);
    return null;
  }
}

async function translateViaClaudeFallback(prompt: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL_FOR_TRANSLATION,
      max_tokens: TRANSLATE_MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: prompt }],
    } as any);
    if (resp.stop_reason === "max_tokens") {
      console.warn("[fieldOpsTranslation] Claude stop_reason=max_tokens — rejecting");
      return null;
    }
    const blocks = resp.content as unknown as Array<Record<string, unknown>>;
    const translated = blocks
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/^["']|["']$/g, "");
    if (!translated || containsHebrew(translated) || looksTruncatedFieldOpsEnglish(translated)) {
      return null;
    }
    return translated;
  } catch (e) {
    console.warn("[fieldOpsTranslation] Claude fallback failed:", (e as Error).message);
    return null;
  }
}
