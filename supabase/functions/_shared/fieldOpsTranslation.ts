// Shared Hebrew→English translation for Whapi ops-group cards only.
// DB task.description stays Hebrew — callers pass translated text only to sendWhapiText.

const HEBREW_RE = /[\u0590-\u05FF]/;

const GEMINI_MODELS: string[] = (Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

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
    console.warn("[fieldOpsTranslation] GEMINI_API_KEY unset — using Hebrew source for Whapi");
    return style === "room_dash_line" ? `Room ${roomLabel} - ${trimmed}` : trimmed;
  }

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

  console.warn("[fieldOpsTranslation] all models failed — Whapi fallback keeps Hebrew");
  return style === "room_dash_line" ? `Room ${roomLabel} - ${trimmed}` : trimmed;
}
