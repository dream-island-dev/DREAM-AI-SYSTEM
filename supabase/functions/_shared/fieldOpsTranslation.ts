// Shared Hebrew→English translation for Whapi ops-group cards only.
// DB task.description stays Hebrew — callers pass translated text only to sendWhapiText.

const HEBREW_RE = /[\u0590-\u05FF]/;

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const GEMINI_MODELS: string[] = (Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Mirrors whatsapp-webhook/index.ts's CLAUDE_MODEL_HAIKU literal — duplicated,
// not imported, per this repo's _shared/ Deno function-boundary convention
// (shared files stay self-contained, e.g. whapiSend.ts/whapiMedia.ts). Haiku,
// not the full CLAUDE_MODEL: this is a one-line translation, not a
// conversational reply, so the cheaper/faster model is the right default.
const CLAUDE_MODEL_FOR_TRANSLATION = "claude-haiku-4-5";

export function containsHebrew(text: string): boolean {
  return HEBREW_RE.test(text);
}

export type FieldOpsTranslateStyle = "description_only" | "room_dash_line";

export async function translateTextForFieldOps(
  text: string,
  opts?: { room?: string | null; style?: FieldOpsTranslateStyle },
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (!containsHebrew(trimmed)) return trimmed;

  const roomLabel = opts?.room?.trim() || "—";
  const style = opts?.style ?? "description_only";

  const prompt = style === "room_dash_line"
    ? `Translate this Hebrew in-suite hotel guest service request into one concise professional English line for field staff. ` +
      `Format exactly: "Room ${roomLabel} - <request in English>". Output ONLY that single English line.\n\n` +
      `Hebrew: ${trimmed}`
    : `Translate this Hebrew hotel operations task description into concise professional English for field staff. ` +
      `Output ONLY the English translation — one line, no quotes, no Hebrew, no room prefix.\n\n` +
      `Staff task (Hebrew): ${trimmed}`;

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.warn("[fieldOpsTranslation] GEMINI_API_KEY unset — trying Claude fallback");
  } else {
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 160, temperature: 0.2, candidateCount: 1 },
    });

    for (const model of GEMINI_MODELS.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20000) },
        );
        if (res.status === 404) continue;
        if (!res.ok) {
          console.warn(`[fieldOpsTranslation] Gemini ${model} ${res.status}`);
          continue;
        }
        const data = await res.json();
        const rawParts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>;
        const translated = (rawParts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "").trim()
          .replace(/^["']|["']$/g, "");
        if (translated && !containsHebrew(translated)) {
          return translated;
        }
      } catch (e) {
        console.warn(`[fieldOpsTranslation] Gemini ${model} failed:`, (e as Error).message);
      }
    }
  }

  const claudeTranslated = await translateViaClaudeFallback(prompt);
  if (claudeTranslated) {
    console.info("[fieldOpsTranslation] Claude fallback succeeded");
    return claudeTranslated;
  }

  console.warn("[fieldOpsTranslation] all engines (Gemini + Claude) failed — Whapi fallback keeps Hebrew");
  return style === "room_dash_line" ? `Room ${roomLabel} - ${trimmed}` : trimmed;
}

// Self-contained Claude fallback — only reached when Gemini is unset or every
// Gemini model failed/returned Hebrew (see GEMINI_API_KEY guard + the loop
// above). Not a reuse of whatsapp-webhook/index.ts's callClaude(): that
// function is tightly coupled to the FAQ-reply flow (conversational system
// prompt, guest history threading, log_guest_request tool-calling) — wiring
// it in here would incorrectly attach irrelevant persona/tool machinery to a
// plain one-line translation.
async function translateViaClaudeFallback(prompt: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL_FOR_TRANSLATION,
      max_tokens: 160,
      messages: [{ role: "user", content: prompt }],
    } as any);
    const blocks = resp.content as unknown as Array<Record<string, unknown>>;
    const translated = blocks
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/^["']|["']$/g, "");
    return translated && !containsHebrew(translated) ? translated : null;
  } catch (e) {
    console.warn("[fieldOpsTranslation] Claude fallback failed:", (e as Error).message);
    return null;
  }
}
