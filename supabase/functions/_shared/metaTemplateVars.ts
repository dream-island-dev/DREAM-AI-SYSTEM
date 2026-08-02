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
  dream_survey_invite: 1,
  dream_spa_warmup: 1,
  dream_spa_package: 1,
  spa_upsell_daypass: 1,
  dream_daypass_eve: 1,
};

/** Minimal body snapshots for param-count fallback when Meta API is unreachable. */
const TEMPLATE_BODY_PARAM_SNAPSHOTS: Record<string, string> = {
  dream_room_ready:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך!",
  dream_room_ready1:
    "🔑 {{1}}, יש לנו בשורה — הסוויטה שלך מוכנה ומחכה לך!",
  night_before_suites: "היי {{1}} מה שלומכם?",
  dream_suite_reminder: "היי {{1}} — {{2}} — {{3}}",
  dream_survey_invite:
    "היי{{1}}, תודה שביליתם איתנו היום! 🌴\n\nנשמח שתדרגו את החוויה שלכם במתחם 🙏🏽",
  dream_spa_warmup:
    "היי {{1}}, עוד קצת ומתחיל הטיפול המפנק שלכם בספא 🧘‍♀️✨\nזה הזמן להירגע, לנשום עמוק ולהתחיל לעבור למצב פינוק. ניפגש בקרוב!",
  dream_spa_package:
    "היי {{1}} 💆\nלקראת הגעתכם למתחם, נשמח להציע לכם עיסוי מרגיע של 45 דק׳ להזמנה שלכם ב-300 ₪ לאדם בלבד (מחיר מלא 370 ₪).\nהשיבו לנו כאן וניצור עימכם קשר לצורך תיאום 🙏",
  spa_upsell_daypass:
    "היי {{1}}💆\nלקראת הגעתכם לריזורט, נשמח להציע לכם טיפול ספא מרגיע של 45 דק׳ להזמנה שלכם במחיר מיוחד. עבורכם -300 ₪ לאדם בלבד (מחיר מלא 370 ₪).\nהשיבו לנו כאן וניצור עימכם קשר לצורך תיאום 🙏",
  dream_daypass_eve:
    "היי {{1}}, מחר מחכה לכם יום מדהים בדרים איילנד! ☀️",
};

const _expectedCountCache = new Map<string, number>();
const _imageHeaderPresenceCache = new Map<string, boolean>();

type MetaTemplateComponent = { type?: string; format?: string; text?: string };
type MetaTemplateRow = { name?: string; components?: MetaTemplateComponent[] };

const _templateRowCache = new Map<string, MetaTemplateRow | null>();

/** Public URL defaults when Meta's live template has an IMAGE header (API link param). */
export const META_TEMPLATE_IMAGE_HEADER_URLS: Record<string, string> = {
  dream_suite_reminder:
    "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites_shabbat:
    "https://dream-ai-system.vercel.app/images/suiteshabat.jpeg",
};

async function fetchMetaTemplateRow(templateName: string): Promise<MetaTemplateRow | null> {
  const key = String(templateName ?? "").trim();
  if (!key) return null;
  if (_templateRowCache.has(key)) return _templateRowCache.get(key) ?? null;

  let token: string | undefined;
  let wabaId: string | undefined;
  try {
    token = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
    wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID")
      ?? Deno.env.get("META_PHONE_NUMBER_ID")
      ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  } catch {
    _templateRowCache.set(key, null);
    return null;
  }
  if (!token || !wabaId) {
    _templateRowCache.set(key, null);
    return null;
  }

  const url =
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
    `?name=${encodeURIComponent(key)}` +
    `&fields=name,components&limit=5`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      _templateRowCache.set(key, null);
      return null;
    }
    const json = await res.json() as { data?: MetaTemplateRow[] };
    const row = (json.data ?? []).find((t) => t.name === key) ?? json.data?.[0] ?? null;
    _templateRowCache.set(key, row);
    return row;
  } catch {
    _templateRowCache.set(key, null);
    return null;
  }
}

async function fetchMetaTemplateBodyText(templateName: string): Promise<string | null> {
  const row = await fetchMetaTemplateRow(templateName);
  const body = row?.components?.find((c) => c.type === "BODY")?.text?.trim() ?? "";
  return body || null;
}

/** True when Meta's approved template includes HEADER format IMAGE. */
export function metaTemplateHasImageHeader(components: MetaTemplateComponent[]): boolean {
  return components.some(
    (c) =>
      String(c.type ?? "").toUpperCase() === "HEADER" &&
      String(c.format ?? "").toUpperCase() === "IMAGE",
  );
}

/**
 * Resolve IMAGE header link for a template send — queries live Meta components first.
 * Returns undefined when the approved template has no IMAGE header (body-only).
 * On API failure: only dream_suite_reminder assumes IMAGE (legacy); night_before_* stay text-only.
 */
export async function resolveMetaTemplateImageHeaderUrl(
  templateName: string,
  overrideUrl?: string | null,
): Promise<string | undefined> {
  const key = String(templateName ?? "").trim();
  if (!key) return undefined;

  let hasImage: boolean;
  if (_imageHeaderPresenceCache.has(key)) {
    hasImage = _imageHeaderPresenceCache.get(key)!;
  } else {
    const row = await fetchMetaTemplateRow(key);
    if (row?.components) {
      hasImage = metaTemplateHasImageHeader(row.components);
    } else {
      hasImage = key === "dream_suite_reminder";
    }
    _imageHeaderPresenceCache.set(key, hasImage);
    console.log(
      `[metaTemplateVars] template="${key}" live IMAGE header=${hasImage}` +
      (row?.components ? "" : " (Meta API unavailable — fail-safe)"),
    );
  }

  if (!hasImage) {
    const explicit = String(overrideUrl ?? "").trim();
    if (explicit) {
      console.warn(
        `[metaTemplateVars] template="${key}": image override ignored` +
        ` — approved Meta template has no IMAGE header`,
      );
    }
    return undefined;
  }

  const explicit = String(overrideUrl ?? "").trim();
  if (explicit) return explicit;
  return META_TEMPLATE_IMAGE_HEADER_URLS[key];
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
  _imageHeaderPresenceCache.clear();
  _templateRowCache.clear();
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
