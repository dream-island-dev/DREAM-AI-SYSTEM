// supabase/functions/suggest-import-mapping/index.ts
// ══════════════════════════════════════════════════════════════════════════════
// RESILIENT IMPORT AGENT — proposes a column mapping for an uploaded Excel/CSV
// file against a known target schema. Never writes to the DB, never sees more
// than 3 sample rows. The frontend (ArrivalImportPanel.js → MappingReviewPanel.js)
// always shows the proposal to an admin for review/edit before anything is
// applied — this function only PROPOSES.
//
// Model router follows the same Gemini→Claude pattern as chat/index.ts and
// whatsapp-webhook/index.ts (GEMINI_MODELS fallback list + thought-leak skip,
// since this call depends on clean JSON output unlike the prose-returning
// functions elsewhere in this codebase).
//
// SCHEMAS registry below mirrors src/utils/importMapper.js's SUITE_ARRIVALS_SCHEMA
// — the two are the source of truth for "what fields exist" on two separate
// runtimes (Deno edge function vs. browser JS) that cannot share a module in
// this codebase. Keep them in sync by hand.
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODELS: string[] = Deno.env.get("GEMINI_MODEL")
  ? [Deno.env.get("GEMINI_MODEL")!]
  : [
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];
const CLAUDE_MODEL = "claude-sonnet-4-6"; // last-resort fallback only — ANTHROPIC_API_KEY is degraded per CLAUDE.md

// ══════════════════════════════════════════════════════════════════════════════
// §1  SCHEMA DESCRIPTOR REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
type FieldSpec = {
  label:          string;             // Hebrew label, shown to the AI and the admin
  kind:           "value" | "text_blob"; // text_blob = free text scanned for an embedded phone+name (remark fields)
  required:       "hard" | "soft" | "optional";
  defaultPolicy?: string;             // human-readable safe-default description, if one exists
  example:        string;             // real-world example value, helps the model recognize the column
};

const SCHEMAS: Record<string, Record<string, FieldSpec>> = {
  suite_arrivals: {
    orderNumber:  { label: "מספר הזמנה (PMS)",                               kind: "value",     required: "hard",     example: "266932" },
    resLineId:    { label: "מזהה שורת חדר גלובלי (מפתח ייחודי לכל חדר)",       kind: "value",     required: "hard",     example: "9821345" },
    roomName:     { label: "מספר/שם חדר",                                    kind: "value",     required: "optional", example: "8" },
    suiteType:    { label: "סוג סוויטה/חבילה",                                kind: "value",     required: "optional", example: "סוויטת אמטיסט" },
    coordName:    { label: "שם מזמין/קבוצה (קואורדינטור ההזמנה)",              kind: "value",     required: "optional", example: "ישראל ישראלי" },
    coordPhone:   { label: "טלפון מזמין — ספרות בלבד, לרוב ללא 0 מוביל",        kind: "value",     required: "soft",     example: "525778390" },
    remark:       { label: "הערה חופשית — מכילה שם+טלפון האורח האמיתי בתוך הטקסט", kind: "text_blob", required: "soft",     example: "מוחמד עדילה 052-5778390" },
    opRemark:     { label: "הערה תפעולית משנית — אותו פורמט כמו ההערה הראשית",  kind: "text_blob", required: "optional", example: "" },
    adults:       { label: "מספר מבוגרים",                                   kind: "value",     required: "optional", defaultPolicy: "1", example: "2" },
    children:     { label: "מספר ילדים",                                     kind: "value",     required: "optional", defaultPolicy: "0", example: "0" },
    nights:       { label: "מספר לילות",                                     kind: "value",     required: "optional", defaultPolicy: "0", example: "2" },
    checkinTime:  { label: "שעת צ׳ק-אין",                                    kind: "value",     required: "optional", example: "15:00" },
    checkoutTime: { label: "שעת צ׳ק-אאוט",                                   kind: "value",     required: "optional", example: "11:00" },
    groupId:      { label: "דגל בילוי-יומי (1 = אורח יומי, ללא לינה)",          kind: "value",     required: "optional", defaultPolicy: "0", example: "0" },
    price:        { label: "מחיר",                                          kind: "value",     required: "optional", defaultPolicy: "0", example: "1200" },
    arrivalDate:  { label: "תאריך הגעה",                                     kind: "value",     required: "soft",     defaultPolicy: "היום (כשאין עמודת תאריך כלל)", example: "2026-06-18" },
    leadSource:   { label: "מקור הגעה (Lead Source)",                        kind: "value",     required: "optional", example: "מחלקת מכירות" },
    guestPhone:   { label: "טלפון אורח (עמודה ישירה, ללא הערות)",             kind: "value",     required: "optional", example: "0522468207" },
  },
  // Inventory Smart-Intake Module — InventoryImportPanel.js's "חידוש מלאי" card.
  // parLevel/restockColumn are read as PLAIN computed values, same as every
  // other column here — no formula-syntax parsing needed. The sheet's own
  // formula already produced these numbers; we just read them like any cell.
  // If only restockColumn is mapped (no visible target column), the frontend
  // derives parLevel = currentQuantity + restockColumn per row — arithmetic
  // on visible numbers, not a re-implementation of the original formula.
  inventory_renewal: {
    itemName:       { label: "שם הפריט (מגבות, סבון, מצעים וכו׳)",                                 kind: "value", required: "hard",     example: "מגבות חדר" },
    currentQuantity: { label: "כמות נוכחית/שנספרה בפועל",                                          kind: "value", required: "hard",     example: "42" },
    unit:           { label: "יחידת מידה",                                                       kind: "value", required: "optional", defaultPolicy: "יח׳", example: "בקבוקים" },
    category:       { label: "קטגוריה (טקסטיל, אמבטיה, מתכלים...)",                                kind: "value", required: "optional", defaultPolicy: "other", example: "אמבטיה" },
    parLevel:       { label: "עמודת יעד/מלאי מינימלי, אם קיימת בקובץ כעמודה נפרדת",                  kind: "value", required: "optional", example: "60" },
    restockColumn:  { label: "עמודת ׳להשלים/חסר׳ המחושבת בנוסחה הקיימת בקובץ (אם אין עמודת יעד נפרדת)", kind: "value", required: "optional", example: "18" },
  },
  // Voucher Reconciliation Engine (Yelena, session 49/migration 091) — the two
  // import sides reconcile-vouchers/index.ts maps before writing to
  // voucher_provider_reports / voucher_easygo_records. voucherNumber is
  // "soft" not "hard": both target columns are nullable on purpose (an
  // unparseable row is still inserted and surfaced as a reconciliation
  // exception, never silently dropped — Zero Data Loss, CLAUDE.md §0.1).
  voucher_provider_report: {
    voucherNumber: { label: "מספר שובר/קופון",                          kind: "value", required: "soft",     example: "HZ-4821-0007" },
    guestName:     { label: "שם האורח כפי שמופיע בדוח הספק",              kind: "value", required: "soft",     example: "ישראל ישראלי" },
    packageType:   { label: "סוג חבילה/שובר",                           kind: "value", required: "optional", example: "זוגי + שמפניה" },
    amount:        { label: "סכום ששולם (₪)",                          kind: "value", required: "optional", example: "450" },
    purchaseDate:  { label: "תאריך רכישת השובר",                        kind: "value", required: "optional", example: "10/06/2026" },
  },
  voucher_easygo_report: {
    voucherNumber: { label: "מספר שובר כפי שמופיע בדוח השוברים של EasyGo", kind: "value", required: "soft",     example: "HZ-4821-00070192" },
    guestName:     { label: "שם האורח",                                 kind: "value", required: "soft",     example: "ישראל ישראלי" },
    phone:         { label: "טלפון האורח",                              kind: "value", required: "optional", example: "0525778390" },
    orderNumber:   { label: "מספר הזמנה (PMS)",                          kind: "value", required: "optional", example: "266932" },
    packageType:   { label: "סוג חבילה/שובר שהוזמן",                     kind: "value", required: "optional", example: "זוגי + שמפניה" },
    amount:        { label: "סכום (₪)",                                 kind: "value", required: "optional", example: "450" },
    arrivalDate:   { label: "תאריך הגעה",                                kind: "value", required: "optional", example: "18/06/2026" },
  },
};

// Short domain label per schema — used to frame the prompt correctly for
// whichever document type is actually being mapped (was hardcoded to "hotel
// guest bookings" before the inventory schema was added).
const SCHEMA_DOMAIN_LABELS: Record<string, string> = {
  suite_arrivals:           "הזמנות אורחים במלון",
  inventory_renewal:        "טפסי חידוש/ספירת מלאי",
  voucher_provider_report:  "דוחות שוברים מספקים חיצוניים (Hightech Zone / Dolce Vita / Pais Plus / Hever / Nofshonit)",
  voucher_easygo_report:    "דוח השוברים של EasyGo (מה שהצוות הזמין בפועל)",
};

// ══════════════════════════════════════════════════════════════════════════════
// §2  PROMPT
// ══════════════════════════════════════════════════════════════════════════════
function buildPrompt(
  schema: Record<string, FieldSpec>,
  headers: string[],
  sampleRows: Record<string, unknown>[],
  domainLabel: string,
): string {
  const fieldList = Object.entries(schema)
    .map(([key, spec]) => {
      const defaultNote = spec.defaultPolicy ? `. ברירת מחדל בטוחה אם אין עמודה מתאימה: ${spec.defaultPolicy}` : "";
      const blobNote = spec.kind === "text_blob" ? " [שדה טקסט חופשי — לא להעתיק ערך, רק לסמן איזו עמודה היא המקור]" : "";
      return `- "${key}" (${spec.required}): ${spec.label}. דוגמה אמיתית: "${spec.example}"${defaultNote}${blobNote}`;
    })
    .join("\n");

  const sampleText = sampleRows.slice(0, 3).map((r, i) =>
    `שורה ${i + 1}: ` + headers.map(h => `${JSON.stringify(h)}=${JSON.stringify(r[h] ?? "")}`).join(", ")
  ).join("\n") || "(לא התקבלו שורות דוגמה)";

  return `אתה מנתח קבצי Excel/CSV של ${domainLabel} ומציע מיפוי עמודות למערכת ניהול.

כותרות העמודות שזוהו בקובץ שהועלה (בדיוק כך, אותיות רגישות):
${headers.map(h => JSON.stringify(h)).join(", ")}

שלוש שורות דוגמה (ערכי טלפון עלולים להיות מוסתרים חלקית מטעמי פרטיות — זה תקין, התעלם מההסתרה):
${sampleText}

שדות המטרה שיש למפות אליהם (key, רמת חיוניות, תיאור):
${fieldList}

החזר אך ורק JSON תקני (ללא טקסט נוסף לפני/אחרי, ללא markdown code fence) במבנה המדויק הזה:
{
  "mapping": { "<targetFieldKey>": "<כותרת עמודה מדויקת מהרשימה לעיל, או null אם לא נמצאה>", ... },
  "defaults": { "<targetFieldKey>": { "value": "<ערך ברירת מחדל מוצע>", "reason": "<הסבר קצר בעברית>" }, ... },
  "recommendations": ["<אזהרה/הערה קצרה בעברית>", ...],
  "confidence": { "<targetFieldKey>": "high" | "low", ... }
}

חובה: כל מפתח ב-"mapping" חייב להיות אחד מתוך ${JSON.stringify(Object.keys(schema))} בדיוק. כל ערך ב-"mapping" חייב להיות אחת מכותרות העמודות שניתנו לעיל בדיוק, או null. אל תמציא כותרת עמודה שלא קיימת ברשימה. כלול "defaults" רק לשדות עם required="hard" או "soft" שלא נמצאה להם עמודה.`;
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  MODEL ROUTER — Gemini (multi-model fallback) → Claude (last resort)
// ══════════════════════════════════════════════════════════════════════════════
async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("no_gemini_key");

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.2, candidateCount: 1 },
  });

  for (const model of GEMINI_MODELS) {
    console.log(`[suggest-import-mapping] calling Gemini model="${model}"`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20000) },
    );

    if (res.status === 404) {
      console.warn(`[suggest-import-mapping] model "${model}" not found — trying next`);
      continue;
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`gemini_${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    // Skip thinking-mode parts (gemini-2.5 returns thought:true blocks before the real reply) —
    // critical here since a leaked thought block would break JSON.parse downstream.
    const rawParts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>;
    const realPart = rawParts.find(p => !p.thought && typeof p.text === "string");
    const text = (realPart?.text ?? "").trim();
    const finishReason = data?.candidates?.[0]?.finishReason as string | undefined;

    if (!text) { console.warn(`[suggest-import-mapping] model "${model}" returned empty text — trying next`); continue; }

    // A non-empty response that was cut off mid-object is worse than an empty
    // one — it silently looks like success but produces invalid_json_response
    // downstream. Treat it the same as a 404: try the next model in the list.
    // (On gemini-2.5-flash this is usually thinking tokens eating the budget
    // before any real output — moving to a non-thinking model fixes it.)
    if (finishReason === "MAX_TOKENS") {
      console.warn(`[suggest-import-mapping] model "${model}" hit MAX_TOKENS (truncated mid-response) — trying next`);
      continue;
    }

    console.log(`[suggest-import-mapping] Gemini OK model="${model}"`);
    return text;
  }

  throw new Error("gemini_all_models_unavailable");
}

async function callClaude(prompt: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 1500,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
  if (!text) throw new Error("claude_empty_response");
  console.log(`[suggest-import-mapping] ✅ Claude OK (fallback) engine=${CLAUDE_MODEL}`);
  return text;
}

function parseModelJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }

  // Last resort: the model added prose before/after the object with no fence at
  // all (common despite explicit instructions not to) — grab the outermost
  // {...} span and try that. Logged with the raw text so a recurring failure
  // is diagnosable from `supabase functions logs` / the dashboard.
  const first = text.indexOf("{");
  const last  = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* fall through to error below */ }
  }

  console.error("[suggest-import-mapping] could not parse model response as JSON. Raw text:", text.slice(0, 1000));
  throw new Error("invalid_json_response");
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  HANDLER
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { schemaKey, headers, sampleRows } = await req.json();

    if (!schemaKey || !Array.isArray(headers) || headers.length === 0) {
      throw new Error("schemaKey and a non-empty headers[] array are required");
    }
    const schema = SCHEMAS[schemaKey];
    if (!schema) throw new Error(`unknown_schema_key: ${schemaKey}`);

    const domainLabel = SCHEMA_DOMAIN_LABELS[schemaKey] ?? schemaKey;
    const prompt = buildPrompt(schema, headers, Array.isArray(sampleRows) ? sampleRows : [], domainLabel);

    let raw: string;
    let engine: "gemini" | "claude";
    try {
      raw = await callGemini(prompt);
      engine = "gemini";
    } catch (e) {
      console.error("[suggest-import-mapping] Gemini failed → trying Claude:", (e as Error).message);
      raw = await callClaude(prompt);
      engine = "claude";
    }

    const parsed = parseModelJson(raw) as {
      mapping?:         Record<string, string | null>;
      defaults?:        Record<string, { value: string; reason: string }>;
      recommendations?: string[];
      confidence?:      Record<string, string>;
    };

    // Defensive validation — never trust the model to only name real fields/headers.
    // A hallucinated field key or a header that doesn't actually exist in this file
    // gets silently dropped here rather than corrupting the review screen.
    const validFields  = new Set(Object.keys(schema));
    const validHeaders = new Set(headers as string[]);
    const cleanMapping: Record<string, string | null> = {};
    for (const [field, header] of Object.entries(parsed.mapping ?? {})) {
      if (!validFields.has(field)) continue;
      cleanMapping[field] = (typeof header === "string" && validHeaders.has(header)) ? header : null;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        engine,
        mapping:         cleanMapping,
        defaults:        parsed.defaults ?? {},
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        confidence:      parsed.confidence ?? {},
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[suggest-import-mapping] error:", raw);

    let userError = raw;
    if (raw.includes("no_gemini_key") || raw.includes("no_anthropic_key")) {
      userError = "לא הוגדר מפתח AI ב-Supabase Secrets — לא ניתן להציע מיפוי אוטומטי. ניתן למפות ידנית בטבלה.";
    } else if (raw.includes("invalid_json_response")) {
      userError = "המודל החזיר תשובה לא תקנית — ניתן למפות ידנית בטבלה.";
    }

    // ⚠️ Always HTTP 200 — so supabase-js populates `data` (not `error`) and the
    // frontend can show userError directly instead of a generic wrapper.
    return new Response(
      JSON.stringify({ ok: false, error: userError }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
