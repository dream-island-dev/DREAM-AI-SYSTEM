// supabase/functions/_shared/guestBotSettings.ts
// Loads bot_settings + bot_config + scripts + learned rules — same priority
// chain for Meta and Whapi guest DM.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  GUEST_BRAIN_CONFIG_TTL_MS,
  buildSystemPromptFromBotConfig,
  appendGuestBrainInvariantSuffixes,
  type GuestBrainChannel,
} from "./guestBotPrompt.ts";

export type GuestBotSettingsRow = {
  system_prompt: string;
  knowledge_base: string;
  preferred_model: string | null;
};

export type LearnedRulesSuffixes = {
  chatSuffix: string;
  routingSuffix: string;
};

const EMPTY_SETTINGS: GuestBotSettingsRow = {
  system_prompt: "",
  knowledge_base: "",
  preferred_model: null,
};

let _configCache: Record<string, string> = {};
let _configCacheAt = 0;
let _settingsCache: GuestBotSettingsRow | null = null;
let _settingsCacheAt = 0;
let _scriptsCache: Record<string, { ai_system_prompt: string | null }> = {};
let _scriptsCacheAt = 0;
let _learnedCache: { data: LearnedRulesSuffixes; at: number } | null = null;

function _formatLearnedBlock(title: string, bullets: string[]): string {
  return bullets.length ? `\n\n${title}\n${bullets.join("\n")}` : "";
}

export async function fetchGuestBotConfig(
  supabase: SupabaseClient,
): Promise<Record<string, string>> {
  const now = Date.now();
  if (now - _configCacheAt < GUEST_BRAIN_CONFIG_TTL_MS && Object.keys(_configCache).length > 0) {
    return _configCache;
  }
  const { data, error } = await supabase.from("bot_config").select("config_key, config_value");
  if (error || !data?.length) return _configCache;
  const map: Record<string, string> = {};
  for (const r of data as Array<{ config_key: string; config_value: string }>) {
    map[r.config_key] = r.config_value;
  }
  _configCache = map;
  _configCacheAt = now;
  return map;
}

export async function fetchGuestBotSettings(
  supabase: SupabaseClient,
): Promise<GuestBotSettingsRow> {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheAt < GUEST_BRAIN_CONFIG_TTL_MS) {
    return _settingsCache;
  }
  const { data, error } = await supabase
    .from("bot_settings")
    .select("system_prompt, knowledge_base, preferred_model")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return _settingsCache ?? EMPTY_SETTINGS;
  _settingsCache = {
    system_prompt:   String((data as Record<string, unknown>).system_prompt ?? ""),
    knowledge_base:  String((data as Record<string, unknown>).knowledge_base ?? ""),
    preferred_model: ((data as Record<string, unknown>).preferred_model as string | null) ?? null,
  };
  _settingsCacheAt = now;
  return _settingsCache;
}

export async function fetchGuestOngoingConciergePrompt(
  supabase: SupabaseClient,
): Promise<string | null> {
  const now = Date.now();
  if (now - _scriptsCacheAt < GUEST_BRAIN_CONFIG_TTL_MS && _scriptsCache["ongoing_concierge"]) {
    return _scriptsCache["ongoing_concierge"].ai_system_prompt;
  }
  const { data } = await supabase
    .from("bot_scripts")
    .select("script_key, ai_system_prompt")
    .eq("script_key", "ongoing_concierge")
    .eq("is_active", true)
    .maybeSingle();
  const prompt = ((data as Record<string, unknown> | null)?.ai_system_prompt as string | undefined)?.trim() || null;
  _scriptsCache["ongoing_concierge"] = { ai_system_prompt: prompt };
  _scriptsCacheAt = now;
  return prompt;
}

export async function fetchGuestLearnedRulesSuffixes(
  supabase: SupabaseClient,
): Promise<LearnedRulesSuffixes> {
  const now = Date.now();
  if (_learnedCache && now - _learnedCache.at < GUEST_BRAIN_CONFIG_TTL_MS) {
    return _learnedCache.data;
  }
  const empty: LearnedRulesSuffixes = { chatSuffix: "", routingSuffix: "" };
  const { data, error } = await supabase
    .from("xos_ai_rules")
    .select("module, rule_text")
    .in("module", ["chat", "routing"])
    .order("created_at", { ascending: true });
  if (error) return _learnedCache?.data ?? empty;

  const byModule: Record<string, string[]> = { chat: [], routing: [] };
  for (const row of (data ?? []) as Array<{ module: string; rule_text: string }>) {
    const t = String(row.rule_text ?? "").trim();
    if (!t) continue;
    const mod = String(row.module ?? "").trim();
    if (mod === "chat" || mod === "routing") byModule[mod].push(`- ${t}`);
  }
  const suffixes: LearnedRulesSuffixes = {
    chatSuffix: _formatLearnedBlock("══ כללים שנלמדו — צ'אט ══", byModule.chat),
    routingSuffix: _formatLearnedBlock("══ כללים שנלמדו — ניתוב (פנימי) ══", byModule.routing),
  };
  _learnedCache = { data: suffixes, at: now };
  return suffixes;
}

export type AssembledGuestBrain = {
  systemPrompt: string;
  preferredModel: string | null;
  promptSource: "bot_settings" | "bot_scripts/ongoing_concierge" | "bot_config";
  routingSuffix: string;
};

/** Same priority as whatsapp-webhook finalSystemPrompt (without per-message guestCtx). */
export async function assembleGuestBrainPrompt(
  supabase: SupabaseClient,
  channel: GuestBrainChannel,
  opts?: { guestContextLine?: string; inHouse?: boolean },
): Promise<AssembledGuestBrain> {
  const [botConfig, botSettings, ongoingPrompt, learned] = await Promise.all([
    fetchGuestBotConfig(supabase),
    fetchGuestBotSettings(supabase),
    fetchGuestOngoingConciergePrompt(supabase),
    fetchGuestLearnedRulesSuffixes(supabase),
  ]);

  const kbSuffix = botSettings.knowledge_base?.trim()
    ? `\n\n══ בסיס ידע הריזורט ══\n${botSettings.knowledge_base.trim()}`
    : "";

  let promptSource: AssembledGuestBrain["promptSource"] = "bot_config";
  let base = buildSystemPromptFromBotConfig(botConfig) + kbSuffix;

  if (botSettings.system_prompt?.trim()) {
    base = botSettings.system_prompt.trim() + kbSuffix;
    promptSource = "bot_settings";
  } else if (ongoingPrompt) {
    base = ongoingPrompt + kbSuffix;
    promptSource = "bot_scripts/ongoing_concierge";
  }

  const guestCtx = opts?.guestContextLine?.trim() ? `\n${opts.guestContextLine.trim()}` : "";
  const systemPrompt = base + learned.chatSuffix + guestCtx
    + appendGuestBrainInvariantSuffixes(channel, { inHouse: opts?.inHouse });

  return {
    systemPrompt,
    preferredModel: botSettings.preferred_model,
    promptSource,
    routingSuffix: learned.routingSuffix,
  };
}
