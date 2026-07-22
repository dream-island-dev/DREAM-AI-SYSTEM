/**
 * Semantic arrival-confirmation classifier (Gemini) — runs only when the guest
 * is in the Stage 1 funnel (pre_arrival_2d sent, not yet confirmed).
 * Button taps and template-exact phrases stay on isArrivalConfirmationMessage.
 */

export type ArrivalConfirmIntent = "confirm" | "decline" | "other";

export type ArrivalConfirmClassification = {
  intent: ArrivalConfirmIntent;
  confidence: number;
  engine: "gemini" | "fallback";
};

export const ARRIVAL_CONFIRM_AI_MIN_CONFIDENCE = 0.65;

const CLASSIFY_MODELS = ["gemini-2.0-flash-lite", "gemini-2.0-flash"];
const CLASSIFY_MEMO_TTL_MS = 120_000;
const _classifyMemo = new Map<string, { at: number; value: ArrivalConfirmClassification }>();

function classifyMemoKey(guestId: unknown, text: string): string {
  return `${guestId ?? "none"}|${text}`;
}

const SYSTEM_PROMPT =
  `You classify a hotel guest's WhatsApp reply to a pre-arrival message that asked them to confirm they are still coming to the resort.

Output JSON only:
{"intent":"confirm"|"decline"|"other","confidence":0.0-1.0}

Rules:
- confirm: guest clearly affirms they will arrive — any natural Hebrew or English phrasing (e.g. "בטח מגיעים", "yes we're coming", "אנחנו בדרך"). If they confirm AND ask something else in the same message, intent is still confirm.
- decline: guest cancels, cannot come, wants date change, or clearly says they are NOT coming.
- other: unrelated question, courtesy only ("תודה"), ambiguous, or logistics without affirming arrival.`;

/** Stage 1 sent, guest has not confirmed yet — safe window for semantic classify. */
export function isGuestAwaitingArrivalConfirmationReply(
  guest: Record<string, unknown> | null,
): boolean {
  if (!guest) return false;
  if (String(guest.status ?? "") === "cancelled") return false;
  if (guest.arrival_confirmed === true) return false;
  return guest.msg_pre_arrival_2d_sent === true;
}

export function parseArrivalConfirmClassification(raw: string): ArrivalConfirmClassification | null {
  try {
    const json = raw.trim().match(/\{[\s\S]*\}/)?.[0] ?? raw.trim();
    const parsed = JSON.parse(json) as { intent?: string; confidence?: number };
    const intent = parsed.intent;
    if (intent !== "confirm" && intent !== "decline" && intent !== "other") return null;
    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
    return { intent, confidence, engine: "gemini" };
  } catch {
    return null;
  }
}

export async function classifyArrivalConfirmationWithAi(
  guestMessage: string,
  opts?: { guestId?: number | string | null },
): Promise<ArrivalConfirmClassification> {
  const text = String(guestMessage ?? "").trim();
  if (!text || text.length < 2) {
    return { intent: "other", confidence: 0, engine: "fallback" };
  }

  const memoKey = classifyMemoKey(opts?.guestId ?? null, text);
  const memoHit = _classifyMemo.get(memoKey);
  if (memoHit && Date.now() - memoHit.at < CLASSIFY_MEMO_TTL_MS) {
    return memoHit.value;
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.warn("[arrivalConfirmationAi] GEMINI_API_KEY unset — fail-closed to other");
    return { intent: "other", confidence: 0, engine: "fallback" };
  }

  for (const model of CLASSIFY_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Guest message:\n${text}` }] }],
            generationConfig: {
              maxOutputTokens: 64,
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (res.status === 404) continue;
      if (!res.ok) {
        console.warn(`[arrivalConfirmationAi] ${model} http ${res.status}`);
        continue;
      }
      const data = await res.json();
      const parts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{
        thought?: boolean;
        text?: string;
      }>;
      const textPart = parts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "";
      const parsed = parseArrivalConfirmClassification(textPart);
      if (parsed) {
        console.info(
          `[arrivalConfirmationAi] ${model} intent=${parsed.intent} confidence=${parsed.confidence} ` +
            `text="${text.slice(0, 80)}"`,
        );
        _classifyMemo.set(memoKey, { at: Date.now(), value: parsed });
        return parsed;
      }
    } catch (e) {
      console.warn(`[arrivalConfirmationAi] ${model} failed:`, (e as Error).message);
    }
  }

  return { intent: "other", confidence: 0, engine: "fallback" };
}
