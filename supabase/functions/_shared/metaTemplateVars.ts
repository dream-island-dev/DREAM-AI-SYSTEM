/**
 * Meta template body variable count — trim/pad before send to prevent #132000.
 * Source of truth order: live Meta API body → production fallback → static snapshot.
 */

/** Count highest {{N}} placeholder index in approved body text. */
export function countMetaBodyParams(bodyText: string): number {
  const nums = [...String(bodyText ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
    parseInt(m[1], 10)
  );
  return nums.length > 0 ? Math.max(...nums) : 0;
}

/**
 * When Meta's live approved body differs from local snapshots.
 * dream_room_ready1: Meta approved {{1}} only; older snapshots list {{2}}.
 */
const PRODUCTION_PARAM_COUNT_FALLBACK: Record<string, number> = {
  dream_room_ready1: 1,
};

/** Minimal body snapshots for param-count fallback when Meta API is unreachable. */
const TEMPLATE_BODY_PARAM_SNAPSHOTS: Record<string, string> = {
  dream_room_ready:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך!",
  dream_room_ready1:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה שלך מוכנה ומחכה לך!",
  night_before_suites: "היי {{1}} מה שלומכם?",
  dream_suite_reminder: "היי {{1}} — {{2}} — {{3}}",
};

const _expectedCountCache = new Map<string, number>();

async function fetchMetaTemplateBodyText(templateName: string): Promise<string | null> {
  let token: string | undefined;
  let wabaId: string | undefined;
  try {
    token = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID")
      ?? Deno.env.get("META_PHONE_NUMBER_ID")
      ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  } catch {
    return null;
  }
  if (!token || !wabaId) return null;

  const url =
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
    `?name=${encodeURIComponent(templateName)}` +
    `&fields=name,components&limit=5`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: Array<{ name?: string; components?: Array<{ type?: string; text?: string }> }>;
    };
    const row = (json.data ?? []).find((t) => t.name === templateName) ?? json.data?.[0];
    const body = row?.components?.find((c) => c.type === "BODY")?.text?.trim() ?? "";
    return body || null;
  } catch {
    return null;
  }
}

/** Resolved expected body param count for a template name (cached per function lifetime). */
export async function resolveExpectedBodyParamCount(templateName: string): Promise<number> {
  const key = String(templateName ?? "").trim();
  if (!key) return 0;
  if (_expectedCountCache.has(key)) return _expectedCountCache.get(key)!;

  const fromApi = await fetchMetaTemplateBodyText(key);
  if (fromApi) {
    const count = countMetaBodyParams(fromApi);
    _expectedCountCache.set(key, count);
    return count;
  }

  if (PRODUCTION_PARAM_COUNT_FALLBACK[key] !== undefined) {
    const count = PRODUCTION_PARAM_COUNT_FALLBACK[key];
    _expectedCountCache.set(key, count);
    return count;
  }

  const snapshot = TEMPLATE_BODY_PARAM_SNAPSHOTS[key];
  if (snapshot) {
    const count = countMetaBodyParams(snapshot);
    _expectedCountCache.set(key, count);
    return count;
  }

  return 0;
}

/** Clear cache — for tests only. */
export function clearExpectedParamCountCache(): void {
  _expectedCountCache.clear();
}

export function sanitizeTemplateVarsForMeta(vars: string[]): string[] {
  return vars.map((v, i) => {
    const t = String(v ?? "").trim();
    if (t) return t;
    if (i === 0) return "אורח יקר";
    if (i === 1) return "12:00";
    if (i === 2) return "15:00";
    return "-";
  });
}

/**
 * Fit caller vars to Meta's expected body slot count.
 * When expectedCount is 0 (unknown), returns sanitized vars unchanged.
 */
export function fitVarsToExpectedCount(
  vars: string[],
  expectedCount: number,
  opts: { guestName?: string } = {},
): string[] {
  if (expectedCount <= 0) return sanitizeTemplateVarsForMeta(vars);

  let working = sanitizeTemplateVarsForMeta(vars);

  if (working.length > expectedCount) {
    const dropped = working.slice(expectedCount);
    console.warn(
      `[metaTemplateVars] trimming ${working.length} body vars to ${expectedCount}` +
      ` — dropped: ${JSON.stringify(dropped)}`,
    );
    working = working.slice(0, expectedCount);
  }

  while (working.length < expectedCount) {
    if (working.length === 0) {
      working.push(String(opts.guestName ?? "").trim() || "אורח יקר");
    } else if (working.length === 1) {
      working.push("12:00");
    } else {
      working.push("15:00");
    }
  }

  return sanitizeTemplateVarsForMeta(working);
}

export const TWO_PARAM_ROOM_TEMPLATES = new Set([
  "dream_room_ready",
  "dream_room_ready1",
]);

export function buildTwoParamRoomVars(guest: Record<string, unknown>): string[] {
  return sanitizeTemplateVarsForMeta([
    String(guest.name ?? ""),
    String(guest.room ?? guest.suite_name ?? ""),
  ]);
}
