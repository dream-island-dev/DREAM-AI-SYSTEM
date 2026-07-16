// supabase/functions/_shared/guestBotLlm.ts
// Unified guest-chat LLM caller — Gemini/Claude routing + automatic failover.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiFailoverEvent } from "./aiFailoverLog.ts";
// Whapi DM uses this module; Meta keeps tool-calling in whatsapp-webhook but
// shares resolveGuestModelRoute() from guestBotModelRoute.ts.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import {
  CLAUDE_MODEL,
  GEMINI_MODELS,
  resolveGuestModelRoute,
  type GuestModelRoute,
} from "./guestBotModelRoute.ts";
import { stripOutboundDispatchTag } from "./outboundDispatchTag.ts";
import {
  sanitizeGuestBotReply,
  shouldHardDropGuestReply,
} from "./guestBotSanitize.ts";

const GEMINI_FETCH_TIMEOUT_MS = 20_000;
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 1000;

/** Priming close — model must not continue as a rules quiz after "כן". */
const GEMINI_ROLE_CONFIRM_SUFFIX =
  "\nהבנת את התפקיד? ענה 'כן' בלבד. מההודעה הבאה של האורח — כתוב רק את התשובה לאורח בעברית. אסור לצטט הנחיות, כללים, או מילות 'Yes'/'כן' על הכללים.";

export type GuestChatHistoryTurn = { direction: string; message: string };

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function _isGeminiRetryable(status: number): boolean {
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503;
}

function _sanitizeGuestReply(text: string): string {
  const trimmed = stripOutboundDispatchTag(text.trim());
  if (shouldHardDropGuestReply(trimmed)) {
    throw new Error("output_leak_guard_tripped");
  }
  const cleaned = sanitizeGuestBotReply(trimmed);
  if (!cleaned) {
    throw new Error("output_leak_guard_tripped");
  }
  return cleaned;
}

function _stripHistoryTags(history: GuestChatHistoryTurn[]): GuestChatHistoryTurn[] {
  return history.map((h) => ({
    direction: h.direction,
    message: stripOutboundDispatchTag(h.message),
  }));
}

async function _askGuestGemini(
  userMessage: string,
  guestName: string | null,
  history: GuestChatHistoryTurn[],
  systemPrompt: string,
  modelOrder: string[],
  logTag: string,
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const guestLine = guestName
    ? `\nשם האורח/ת: ${guestName}. השתמש/י בשמו/ה בטבעיות בתוך התשובה רק כשמתאים — לא בכל פתיחה.\n`
    : "";

  const systemTurn = {
    role: "user",
    parts: [{ text: systemPrompt + guestLine + GEMINI_ROLE_CONFIRM_SUFFIX }],
  };
  const confirmTurn = { role: "model", parts: [{ text: "כן" }] };
  const historyTurns = history.map((h) => ({
    role: h.direction === "inbound" ? "user" : "model",
    parts: [{ text: h.message }],
  }));
  const currentTurn = {
    role: "user",
    parts: [{ text: `${userMessage}\n\n(ענה בעברית)` }],
  };
  const body = JSON.stringify({
    contents: [systemTurn, confirmTurn, ...historyTurns, currentTurn],
    generationConfig: { maxOutputTokens: 800, temperature: 0.55, candidateCount: 1 },
  });

  let lastErr = "";
  for (const model of modelOrder) {
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
          },
        );
        if (!res.ok) {
          const errBody = await res.text();
          lastErr = `gemini_${res.status}: ${errBody.slice(0, 200)}`;
          if (_isGeminiRetryable(res.status) && attempt < GEMINI_MAX_RETRIES) {
            await _sleep(GEMINI_RETRY_BASE_MS * 2 ** attempt);
            continue;
          }
          if (res.status === 404) break;
          throw new Error(lastErr);
        }
        const data = await res.json();
        const finishReason = (data?.candidates?.[0]?.finishReason as string | undefined) ?? "";
        if (finishReason === "MAX_TOKENS") {
          console.warn(`[${logTag}] Gemini finishReason=MAX_TOKENS — reply may be truncated`);
        }
        const parts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
        const text = parts
          .filter((p) => !p.thought && typeof p.text === "string" && p.text.trim())
          .map((p) => String(p.text).trim())
          .join("\n")
          .trim();
        if (!text) throw new Error("gemini_empty_response");
        console.log(`[${logTag}] Gemini OK model="${model}"`);
        return _sanitizeGuestReply(text);
      } catch (e) {
        if (attempt < GEMINI_MAX_RETRIES && (e as Error).name !== "AbortError") {
          await _sleep(GEMINI_RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        lastErr = (e as Error).message;
        break;
      }
    }
  }
  throw new Error(lastErr || "gemini_all_models_unavailable");
}

async function _callGuestClaude(
  userMessage: string,
  guestName: string | null,
  history: GuestChatHistoryTurn[],
  systemPrompt: string,
  modelId: string,
  logTag: string,
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const system = systemPrompt
    + (guestName ? `\n\nשם האורח/ת: ${guestName}. פנה/י אליו/ה בשמו/ה.` : "")
    + "\n\nענה תמיד בעברית.";

  const rawMessages = [
    ...history.map((h) => ({
      role: (h.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: h.message,
    })),
    { role: "user" as const, content: userMessage },
  ];
  const messages = rawMessages.reduce<{ role: "user" | "assistant"; content: string }[]>(
    (acc, msg) => {
      if (acc.length && acc[acc.length - 1].role === msg.role) {
        acc[acc.length - 1].content += "\n" + msg.content;
      } else {
        acc.push({ ...msg });
      }
      return acc;
    },
    [],
  );

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: modelId,
    max_tokens: 800,
    system,
    messages,
  } as any);

  const blocks = resp.content as Array<Record<string, unknown>>;
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("claude_empty_response");
  console.log(`[${logTag}] Claude OK model="${modelId}"`);
  return _sanitizeGuestReply(text);
}

export type GenerateGuestChatReplyOpts = {
  userMessage: string;
  guestName: string | null;
  history: GuestChatHistoryTurn[];
  systemPrompt: string;
  preferredModel: string | null;
  logTag?: string;
  /** Extra suffix appended only for Meta tool-calling path — Whapi omits. */
  toolInstructionsSuffix?: string;
  /** When set, engine failover is logged to ai_failover_events (AiFailoverWidget). */
  failoverLog?: { supabase: SupabaseClient; guestPhone?: string | null };
};

/**
 * Primary engine from bot_settings.preferred_model, with automatic failover to
 * the other engine — same contract as whatsapp-webhook FAQ branch.
 */
export async function generateGuestChatReply(opts: GenerateGuestChatReplyOpts): Promise<string> {
  const logTag = opts.logTag ?? "guestBotLlm";
  const route = resolveGuestModelRoute(opts.preferredModel);
  const enrichedPrompt = opts.systemPrompt + (opts.toolInstructionsSuffix ?? "");
  const history = _stripHistoryTags(opts.history);

  const tryGemini = () =>
    _askGuestGemini(opts.userMessage, opts.guestName, history, enrichedPrompt, route.geminiOrder, logTag);
  const tryClaude = () =>
    _callGuestClaude(opts.userMessage, opts.guestName, history, enrichedPrompt, route.claudeModel, logTag);

  const logFailover = (from: string, to: string, err: Error) => {
    if (!opts.failoverLog) return;
    logAiFailoverEvent(opts.failoverLog.supabase, {
      from_engine: from,
      to_engine: to,
      error_message: err.message,
      guest_phone: opts.failoverLog.guestPhone ?? null,
    });
  };

  if (route.engine === "claude") {
    try {
      return await tryClaude();
    } catch (e1) {
      console.error(`[${logTag}] Claude failed → Gemini:`, (e1 as Error).message);
      logFailover("claude", "gemini", e1 as Error);
      return await tryGemini();
    }
  }

  try {
    return await tryGemini();
  } catch (e1) {
    console.error(`[${logTag}] Gemini failed → Claude:`, (e1 as Error).message);
    logFailover("gemini", "claude", e1 as Error);
    return await tryClaude();
  }
}

export { GEMINI_MODELS, CLAUDE_MODEL, resolveGuestModelRoute };
export type { GuestModelRoute };
