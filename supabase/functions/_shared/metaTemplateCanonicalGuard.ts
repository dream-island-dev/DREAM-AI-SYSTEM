/**
 * Pre-send guard: Meta-approved template BODY must match ACC canonical copy
 * (bot_scripts for journey stages). Prevents silent drift where XOS UI / DB
 * shows 12:00 entry but Facebook still delivers an old 09:00 approved version.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  TEMPLATE_BODY_APPROVED,
  fetchLiveMetaTemplateBody,
} from "./metaTemplateLog.ts";

/** Meta template name → bot_scripts.script_key (ACC session editor). */
export const META_TEMPLATE_CANONICAL_SCRIPT_KEY: Record<string, string> = {
  suite_welcome_morning: "stage_3_morning",
  suite_welcome_morning_shabbat: "stage_3_morning_shabbat",
};

/** Meta templates whose canonical body is the static approved snapshot (not bot_scripts). */
export const META_TEMPLATE_CANONICAL_STATIC: Record<string, string> = {
  night_before_suites: TEMPLATE_BODY_APPROVED.night_before_suites,
  night_before_suites_shabbat: TEMPLATE_BODY_APPROVED.night_before_suites_shabbat,
};

/**
 * Closed-window night_before trusts Meta's live approved body over the local ACC
 * snapshot — wording is Meta's to own once approved. For these templates the guard
 * only checks the embedded time tokens (defense against a genuine stale-version bug
 * like 09:00 vs 12:00) and never blocks the send even when that check fails — it logs
 * instead. suite_welcome_morning (open 09:00-vs-12:00 incident) stays on the strict
 * full-body throw path below.
 */
export const META_TEMPLATE_CANONICAL_WARN_ONLY = new Set<string>([
  "night_before_suites",
  "night_before_suites_shabbat",
]);

const TIME_TOKEN_RE = /\b([0-2]?\d):([0-5]\d)\b/g;

export function extractTimeTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(TIME_TOKEN_RE)) {
    out.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  return out.sort();
}

export function templateTimesMatch(canonical: string, live: string): boolean {
  const a = extractTimeTokens(canonical);
  const b = extractTimeTokens(live);
  if (a.length === 0 || b.length === 0) return false;
  return a.join(",") === b.join(",");
}

export function botScriptTextToMetaTemplateBody(scriptText: string): string {
  return String(scriptText ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, "{{1}}")
    .trim();
}

/** Normalize for equality — ignore whitespace + placeholder numbering. */
export function normalizeTemplateBodyForCompare(text: string): string {
  return String(text ?? "")
    .replace(/\{\{\s*\d+\s*\}\}/g, "{{}}")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, "{{}}")
    .replace(/\s+/g, " ")
    .trim();
}

export function templateBodiesMatch(canonical: string, live: string): boolean {
  const a = normalizeTemplateBodyForCompare(canonical);
  const b = normalizeTemplateBodyForCompare(live);
  if (!a || !b) return false;
  return a === b;
}

export type MetaTemplateDriftResult = {
  ok: true;
  templateName: string;
  liveBody: string;
} | {
  ok: false;
  templateName: string;
  liveBody: string | null;
  canonicalBody: string;
  hebrewError: string;
};

async function loadCanonicalBody(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
): Promise<string | null> {
  const staticBody = META_TEMPLATE_CANONICAL_STATIC[templateName]?.trim();
  if (staticBody) return staticBody;

  const scriptKey = META_TEMPLATE_CANONICAL_SCRIPT_KEY[templateName];
  if (!scriptKey) return null;

  const { data } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", scriptKey)
    .maybeSingle();

  const raw = (data as { message_text?: string } | null)?.message_text?.trim();
  if (!raw) return null;
  return botScriptTextToMetaTemplateBody(raw);
}

export async function checkMetaTemplateCanonicalDrift(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
): Promise<MetaTemplateDriftResult> {
  const canonicalBody = await loadCanonicalBody(supabase, templateName);
  if (!canonicalBody) {
    return { ok: true, templateName, liveBody: "" };
  }

  // Pre-send guard: never trust the process-lifetime preview cache — a re-approved
  // template must be caught immediately, not only after the cache happens to evict.
  const liveBody = await fetchLiveMetaTemplateBody(templateName, { bypassCache: true });
  if (!liveBody) {
    const hebrewError =
      `template_body_drift: לא ניתן לאמת את תבנית Meta "${templateName}" מול ACC — ` +
      `בדיקת Meta API נכשלה. לא נשלח כדי למנוע תוכן לא צפוי.`;
    return { ok: false, templateName, liveBody: null, canonicalBody, hebrewError };
  }

  const isTimeTokenOnly = META_TEMPLATE_CANONICAL_WARN_ONLY.has(templateName);
  const bodiesMatch = isTimeTokenOnly
    ? templateTimesMatch(canonicalBody, liveBody)
    : templateBodiesMatch(canonicalBody, liveBody);
  if (bodiesMatch) {
    return { ok: true, templateName, liveBody };
  }

  const hebrewError =
    `template_body_drift: תבנית Meta "${templateName}" לא תואמת לטקסט ב-ACC. ` +
    `Meta שולחת גרסה ישנה/שונה — עדכן ואשר ב-Meta Business Manager או העבר אוטומציה ל-Whapi. ` +
    `(ACC: ${snippetForLog(canonicalBody)} | Meta חי: ${snippetForLog(liveBody)})`;

  return { ok: false, templateName, liveBody, canonicalBody, hebrewError };
}

function snippetForLog(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
}

/**
 * Throws when live Meta body ≠ ACC canonical. Used before sendViaTemplate on journey stages.
 * Templates in META_TEMPLATE_CANONICAL_WARN_ONLY never throw — a mismatch is logged (console.warn)
 * and the send proceeds, since Meta's live approved body is trusted over the local snapshot.
 */
export async function assertMetaTemplateCanonicalOrThrow(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
): Promise<void> {
  const drift = await checkMetaTemplateCanonicalDrift(supabase, templateName);
  if (!drift.ok) {
    if (META_TEMPLATE_CANONICAL_WARN_ONLY.has(templateName)) {
      console.warn(`[metaTemplateCanonicalGuard] ${drift.hebrewError}`);
      return;
    }
    throw new Error(drift.hebrewError);
  }
}

export function isMetaTemplateDriftError(message: string): boolean {
  return String(message ?? "").includes("template_body_drift:");
}
