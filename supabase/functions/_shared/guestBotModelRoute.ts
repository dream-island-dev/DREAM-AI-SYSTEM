// supabase/functions/_shared/guestBotModelRoute.ts
// Single source of truth for guest-chat model routing — BotSettings.js,
// whatsapp-webhook (Meta), and whapi-webhook (Suites DM) all read the same
// bot_settings.preferred_model through resolveGuestModelRoute().

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const CLAUDE_MODEL_HAIKU = "claude-haiku-4-5";

export const GEMINI_MODELS: string[] = Deno.env.get("GEMINI_MODEL")
  ? [Deno.env.get("GEMINI_MODEL")!]
  : [
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];

export type GuestModelRoute = {
  engine: "gemini" | "claude";
  geminiOrder: string[];
  claudeModel: string;
};

/** Maps bot_settings.preferred_model → engine + ordered fallbacks. */
export function resolveGuestModelRoute(preferredModel: string | null): GuestModelRoute {
  const normalized = (preferredModel ?? "").trim();

  if (normalized === "claude-haiku" || normalized === CLAUDE_MODEL_HAIKU) {
    return { engine: "claude", geminiOrder: GEMINI_MODELS, claudeModel: CLAUDE_MODEL_HAIKU };
  }
  if (normalized === "claude" || normalized === CLAUDE_MODEL) {
    return { engine: "claude", geminiOrder: GEMINI_MODELS, claudeModel: CLAUDE_MODEL };
  }
  if (GEMINI_MODELS.includes(normalized)) {
    return {
      engine: "gemini",
      geminiOrder: [normalized, ...GEMINI_MODELS.filter((m) => m !== normalized)],
      claudeModel: CLAUDE_MODEL,
    };
  }
  if (normalized) {
    console.warn(`[guestBotModelRoute] unknown preferred_model "${normalized}" — defaulting to claude`);
  }
  return { engine: "claude", geminiOrder: GEMINI_MODELS, claudeModel: CLAUDE_MODEL };
}
