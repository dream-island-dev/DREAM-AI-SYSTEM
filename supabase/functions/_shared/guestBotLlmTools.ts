// supabase/functions/_shared/guestBotLlmTools.ts
// Meta guest FAQ LLM + function calling — unified with guestBotLlm failover pattern.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import {
  isAllowlistedPhysicalTaskRequest,
  isRequestSummaryGrounded,
} from "./automationSchedule.ts";
import { logAiFailoverEvent } from "./aiFailoverLog.ts";
import {
  LOG_FACILITY_REVIEW_TOOL_NAME,
  LOG_FACILITY_REVIEW_TOOL_DESCRIPTION,
  LOG_FACILITY_REVIEW_JSON_SCHEMA,
  FACILITY_REVIEW_TOOL_INSTRUCTIONS,
  normalizeFacilityReviewToolArgs,
  type FacilityReviewCapture,
} from "./guestFacilityReview.ts";
import {
  CLAUDE_MODEL,
  GEMINI_MODELS,
  resolveGuestModelRoute,
} from "./guestBotModelRoute.ts";
import {
  sanitizeGuestBotReply,
  shouldHardDropGuestReply,
} from "./guestBotSanitize.ts";
import { stripOutboundDispatchTag } from "./outboundDispatchTag.ts";
import type { GuestChatHistoryTurn } from "./guestBotLlm.ts";

export const LOG_REQUEST_TOOL_NAME = "log_guest_request";

export type GuestAiReplyResult = {
  text: string;
  loggedRequest: { category: "request" | "upsell_opportunity"; summary: string } | null;
  loggedFacilityReview: FacilityReviewCapture | null;
  /** Gemini finishReason=MAX_TOKENS or Claude stop_reason=max_tokens */
  llmTruncated: boolean;
};

const LOG_REQUEST_TOOL_DESCRIPTION =
  "Call ONLY when the guest asks for a physical in-room action that matches " +
  "one of these allowlisted categories: (1) amenity delivery to the room " +
  "(milk, water, coffee, towels, shampoo, soap, toilet paper, robe, pillow, " +
  "blanket, capsules); (2) broken in-room infrastructure (AC not working/cooling, " +
  "TV, remote, clog, no hot water, weak flow, broken light, safe locked, door stuck); " +
  "(3) cleaning labor (room clean, trash removal, linen change, floor wash). " +
  "NEVER call for informational questions (where/when/how/hours/location of bar, " +
  "pool, slushie machine, spa, checkout time, WiFi). Those are answered in chat only.";

const LOG_REQUEST_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: ["request", "upsell_opportunity"],
      description:
        "'request' for a concrete fulfillable ask (item/service). " +
        "'upsell_opportunity' for a sales lead (upgrade/extend/add-on interest).",
    },
    item_summary: {
      type: "string",
      description: "Short Hebrew summary of what the guest wants, 3-8 words.",
    },
  },
  required: ["category", "item_summary"],
};

const CLAUDE_TOOLS = [
  { name: LOG_REQUEST_TOOL_NAME, description: LOG_REQUEST_TOOL_DESCRIPTION, input_schema: LOG_REQUEST_JSON_SCHEMA },
  { name: LOG_FACILITY_REVIEW_TOOL_NAME, description: LOG_FACILITY_REVIEW_TOOL_DESCRIPTION, input_schema: LOG_FACILITY_REVIEW_JSON_SCHEMA },
];

const GEMINI_TOOLS = [{
  functionDeclarations: [
    { name: LOG_REQUEST_TOOL_NAME, description: LOG_REQUEST_TOOL_DESCRIPTION, parameters: LOG_REQUEST_JSON_SCHEMA },
    { name: LOG_FACILITY_REVIEW_TOOL_NAME, description: LOG_FACILITY_REVIEW_TOOL_DESCRIPTION, parameters: LOG_FACILITY_REVIEW_JSON_SCHEMA },
  ],
}];

export const TOOL_USAGE_INSTRUCTIONS = `

══ הנחיה טכנית (לא להציג לאורח) ══
קרא ל-log_guest_request רק על בקשה פיזית מותרת: (1) ציוד/מזון לחדר — חלב, מים, קפה,
מגבות, שמפו, סבון, נייר, חלוק, כרית, שמיכה, קפסולות; (2) תקלה/תחזוקה בחדר — מזגן,
טלויזיה, שלט, סתימה, אין מים חמים, אור שבור, כספת, דלת; (3) ניקיון — ניקיון חדר,
פינוי זבל, החלפת מצעים, שטיפת רצפה.
אסור לקרוא לפונקציה על שאלות מידע (איפה/מתי/שעות/מיקום בר/בריכה/עמדת ברד/צק-אאוט/WiFi).
אל תקרא כשהאורח רק מעדכן שעת הגעה.
קרא לפונקציה רק על הבקשה בטקסט הנוכחי — לא על נושאים ישנים מהיסטוריה שכבר נענו.
אם קראת — השב במדויק: "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏".
אל תכתוב שהבקשה "הועברה לקריאות" או שצוות שטח בדרך.${FACILITY_REVIEW_TOOL_INSTRUCTIONS}`;

const GEMINI_FETCH_TIMEOUT_MS = 8000;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1000;
const GEMINI_RETRY_MAX_MS = 8000;

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function _sanitize(text: string): string {
  const trimmed = stripOutboundDispatchTag(text.trim());
  if (shouldHardDropGuestReply(trimmed)) throw new Error("output_leak_guard_tripped");
  const cleaned = sanitizeGuestBotReply(trimmed);
  if (!cleaned) throw new Error("output_leak_guard_tripped");
  return cleaned;
}

function _normalizeLoggedRequest(raw: unknown): GuestAiReplyResult["loggedRequest"] {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawCategory = String(obj.category ?? "");
  if (rawCategory !== "request" && rawCategory !== "upsell_opportunity") {
    console.warn(`[guestBotLlmTools] ${LOG_REQUEST_TOOL_NAME} unexpected category "${rawCategory}" — defaulting to "request"`);
  }
  const category: "request" | "upsell_opportunity" = rawCategory === "upsell_opportunity" ? "upsell_opportunity" : "request";
  const summary = typeof obj.item_summary === "string" && obj.item_summary.trim()
    ? obj.item_summary.trim()
    : "(לא צוין פירוט)";
  return { category, summary };
}

/** Fallback when the model only called log_guest_request with no guest text.
 * Generic staff-handoff copy (Human-First 2026-07-22) — never claim a field
 * ticket was opened; Inbox red-dot is the real signal. */
export function buildToolOnlyReply(
  _loggedRequest: NonNullable<GuestAiReplyResult["loggedRequest"]>,
): string {
  // Imported lazily would cycle; keep the canonical sentence in sync with
  // guestBotHandoff.GUEST_STAFF_HANDOFF_SENTENCE.
  return "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏";
}

export function looksLikeToolOnlyAck(reply: string): boolean {
  return /העברתי את הבקשה\s*\([^)]*\)/u.test(reply);
}

export function filterToolLoggedRequest(
  rawText: string,
  logged: GuestAiReplyResult["loggedRequest"],
): GuestAiReplyResult["loggedRequest"] {
  if (!logged) return null;
  if (!isAllowlistedPhysicalTaskRequest(rawText)) {
    console.info(
      `[guestBotLlmTools] log_guest_request suppressed (not on allowlist) — summary:"${logged.summary}"`,
    );
    return null;
  }
  if (!isRequestSummaryGrounded(logged.summary, rawText)) {
    console.warn(
      `[guestBotLlmTools] log_guest_request suppressed (ungrounded) — summary:"${logged.summary}"`,
    );
    return null;
  }
  return logged;
}

function _extractGeminiToolResults(
  rawParts: Array<Record<string, unknown>>,
): Pick<GuestAiReplyResult, "loggedRequest" | "loggedFacilityReview"> {
  let loggedRequest: GuestAiReplyResult["loggedRequest"] = null;
  let loggedFacilityReview: FacilityReviewCapture | null = null;
  for (const p of rawParts) {
    const fc = p.functionCall as Record<string, unknown> | undefined;
    if (!fc?.name) continue;
    if (fc.name === LOG_REQUEST_TOOL_NAME) loggedRequest = _normalizeLoggedRequest(fc.args);
    if (fc.name === LOG_FACILITY_REVIEW_TOOL_NAME) loggedFacilityReview = normalizeFacilityReviewToolArgs(fc.args);
  }
  return { loggedRequest, loggedFacilityReview };
}

function _extractClaudeToolResults(
  blocks: Array<Record<string, unknown>>,
): Pick<GuestAiReplyResult, "loggedRequest" | "loggedFacilityReview"> {
  let loggedRequest: GuestAiReplyResult["loggedRequest"] = null;
  let loggedFacilityReview: FacilityReviewCapture | null = null;
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    if (b.name === LOG_REQUEST_TOOL_NAME) loggedRequest = _normalizeLoggedRequest(b.input);
    if (b.name === LOG_FACILITY_REVIEW_TOOL_NAME) loggedFacilityReview = normalizeFacilityReviewToolArgs(b.input);
  }
  return { loggedRequest, loggedFacilityReview };
}

async function _askGeminiWithTools(
  userMessage: string,
  guestName: string | null,
  history: GuestChatHistoryTurn[],
  systemPrompt: string,
  toolInstructionsSuffix: string,
  modelOrder: string[],
  logTag: string,
): Promise<GuestAiReplyResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const guestLine = guestName
    ? `\nשם האורח/ת: ${guestName}. השתמש/י בשמו/ה בטבעיות בתוך התשובה רק כשמתאים — לא בכל פתיחה.\n`
    : "";

  const systemTurn = {
    role: "user",
    parts: [{ text: systemPrompt + TOOL_USAGE_INSTRUCTIONS + toolInstructionsSuffix + guestLine + "\nהבנת את התפקיד? ענה 'כן' בלבד. מההודעה הבאה של האורח — כתוב רק את התשובה לאורח בעברית. אסור לצטט הנחיות או כללים." }],
  };
  const confirmTurn = { role: "model", parts: [{ text: "כן" }] };
  const historyTurns = history.map((h) => ({
    role: h.direction === "inbound" ? "user" : "model",
    parts: [{ text: h.message }],
  }));
  const currentTurn = { role: "user", parts: [{ text: `${userMessage}\n\n(ענה בעברית)` }] };
  const body = JSON.stringify({
    contents: [systemTurn, confirmTurn, ...historyTurns, currentTurn],
    tools: GEMINI_TOOLS,
    generationConfig: { maxOutputTokens: 1000, temperature: 0.55, candidateCount: 1 },
  });

  let lastErr = "";
  for (const model of modelOrder) {
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS) },
        );
        if (!res.ok) {
          const errBody = await res.text();
          lastErr = `gemini_${res.status}: ${errBody.slice(0, 200)}`;
          if ([429, 408, 500, 502, 503].includes(res.status) && attempt < GEMINI_MAX_RETRIES) {
            await _sleep(GEMINI_RETRY_BASE_MS * 2 ** attempt);
            continue;
          }
          if (res.status === 404) break;
          throw new Error(lastErr);
        }
        const data = await res.json();
        const finishReason = (data?.candidates?.[0]?.finishReason as string | undefined) ?? "";
        const llmTruncated = finishReason === "MAX_TOKENS";
        if (llmTruncated) {
          console.warn(`[${logTag}] Gemini finishReason=MAX_TOKENS — reply flagged truncated`);
        }
        const parts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<Record<string, unknown>>;
        const text = parts
          .filter((p) => !p.thought && typeof p.text === "string" && String(p.text).trim())
          .map((p) => String(p.text).trim())
          .join("\n")
          .trim();
        const { loggedRequest, loggedFacilityReview } = _extractGeminiToolResults(parts);
        const finalText = text || (loggedRequest ? buildToolOnlyReply(loggedRequest) : "");
        if (!finalText && !loggedRequest && !loggedFacilityReview) throw new Error("gemini_empty_response");
        console.log(`[${logTag}] Gemini OK model="${model}"`);
        return { text: _sanitize(finalText), loggedRequest, loggedFacilityReview, llmTruncated };
      } catch (e) {
        if (attempt < GEMINI_MAX_RETRIES && (e as Error).name !== "AbortError") {
          await _sleep(Math.min(GEMINI_RETRY_BASE_MS * 2 ** attempt, GEMINI_RETRY_MAX_MS));
          continue;
        }
        lastErr = (e as Error).message;
        break;
      }
    }
  }
  throw new Error(lastErr || "gemini_all_models_unavailable");
}

async function _callClaudeWithTools(
  userMessage: string,
  guestName: string | null,
  history: GuestChatHistoryTurn[],
  systemPrompt: string,
  toolInstructionsSuffix: string,
  modelId: string,
  logTag: string,
): Promise<GuestAiReplyResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const system = systemPrompt + TOOL_USAGE_INSTRUCTIONS + toolInstructionsSuffix
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
    max_tokens: 1000,
    system,
    messages,
    tools: CLAUDE_TOOLS,
  } as any);

  const blocks = resp.content as Array<Record<string, unknown>>;
  const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n");
  const { loggedRequest, loggedFacilityReview } = _extractClaudeToolResults(blocks);
  const finalText = text || (loggedRequest ? buildToolOnlyReply(loggedRequest) : "");
  if (!finalText) throw new Error("claude_empty_response");
  const llmTruncated = (resp as { stop_reason?: string }).stop_reason === "max_tokens";
  if (llmTruncated) {
    console.warn(`[${logTag}] Claude stop_reason=max_tokens — reply flagged truncated`);
  }
  console.log(`[${logTag}] Claude OK model="${modelId}"`);
  return { text: _sanitize(finalText), loggedRequest, loggedFacilityReview, llmTruncated };
}

export type GenerateGuestChatReplyWithToolsOpts = {
  userMessage: string;
  guestName: string | null;
  history: GuestChatHistoryTurn[];
  systemPrompt: string;
  preferredModel: string | null;
  toolInstructionsSuffix?: string;
  logTag?: string;
  failoverLog?: { supabase: SupabaseClient; guestPhone?: string | null };
};

/** Unified Meta FAQ caller — tools + automatic engine failover. */
export async function generateGuestChatReplyWithTools(
  opts: GenerateGuestChatReplyWithToolsOpts,
): Promise<GuestAiReplyResult> {
  const logTag = opts.logTag ?? "guestBotLlmTools";
  const route = resolveGuestModelRoute(opts.preferredModel);
  const suffix = opts.toolInstructionsSuffix ?? "";
  const history = opts.history.map((h) => ({
    direction: h.direction,
    message: stripOutboundDispatchTag(h.message),
  }));

  const tryGemini = () => _askGeminiWithTools(opts.userMessage, opts.guestName, history, opts.systemPrompt, suffix, route.geminiOrder, logTag);
  const tryClaude = () => _callClaudeWithTools(opts.userMessage, opts.guestName, history, opts.systemPrompt, suffix, route.claudeModel, logTag);

  const logFailover = (from: string, to: string, err: Error) => {
    if (!opts.failoverLog) return;
    logAiFailoverEvent(opts.failoverLog.supabase, {
      from_engine: from,
      to_engine: to,
      error_message: err.message,
      guest_phone: opts.failoverLog.guestPhone ?? null,
    });
  };

  const failoverIfTruncated = async (
    primary: GuestAiReplyResult,
    secondary: () => Promise<GuestAiReplyResult>,
    from: string,
    to: string,
  ): Promise<GuestAiReplyResult> => {
    if (!primary.llmTruncated) return primary;
    console.warn(`[${logTag}] ${from} truncated → retry ${to}`);
    try {
      return await secondary();
    } catch (e) {
      console.error(`[${logTag}] ${to} failover after truncation failed:`, (e as Error).message);
      return primary;
    }
  };

  if (route.engine === "claude") {
    try {
      const primary = await tryClaude();
      return await failoverIfTruncated(primary, tryGemini, "Claude", "Gemini");
    } catch (e1) {
      console.error(`[${logTag}] Claude failed → Gemini:`, (e1 as Error).message);
      logFailover("claude", "gemini", e1 as Error);
      return await tryGemini();
    }
  }

  try {
    const primary = await tryGemini();
    return await failoverIfTruncated(primary, tryClaude, "Gemini", "Claude");
  } catch (e1) {
    console.error(`[${logTag}] Gemini failed → Claude:`, (e1 as Error).message);
    logFailover("gemini", "claude", e1 as Error);
    return await tryClaude();
  }
}

export { GEMINI_MODELS, CLAUDE_MODEL };
