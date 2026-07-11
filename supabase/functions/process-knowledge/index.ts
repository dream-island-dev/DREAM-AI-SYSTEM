// supabase/functions/process-knowledge/index.ts
// Knowledge ingestion pipeline for Agent Long-Term Memory (Pillar 3).
//
// Receives an uploaded file (PDF / image / plain text) from KnowledgeUploader.js,
// passes it to Gemini (multimodal) for operational rule extraction,
// and batch-inserts the extracted rules into the agent_memory table tagged with
// the authenticated manager's department.
//
// Supported file types:
//   application/pdf           → Gemini inline_data (native PDF parsing)
//   image/png, image/jpeg     → Gemini inline_data (Vision)
//   text/plain                → Gemini text part only (pre-extracted text)
//
// DOCX files are converted to plain text by mammoth.js IN THE BROWSER before
// being sent here as isText=true, so this function never sees raw DOCX bytes.
//
// Request body (JSON):
//   {
//     fileName:  string,          // e.g. "checklist_rules.pdf"
//     mimeType:  string,          // one of the supported MIME types above
//     content:   string,          // base64 for binary files; plain text for text files
//     isText:    boolean          // true → content is plain text; false → content is base64
//   }
//
// Response body (JSON):
//   { ok: true,  rules_extracted: number, rules: [{rule_text, category}] }
//   { ok: false, error: string }
//
// Auth: requires valid Supabase user JWT in Authorization header.
// The manager's department is fetched from profiles (not passed by client —
// prevents department spoofing).
//
// Secrets required:
//   GEMINI_API_KEY              (required — no Claude fallback for multimodal)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Model configuration ───────────────────────────────────────────────────────
// gemini-1.5-flash was retired from the v1beta generateContent API (confirmed
// via live 404s) — this function hardcoded it with no fallback and silently
// failed on every call. Fallback list matches the models already proven live
// in executiveAssistant.ts and whapi-webhook's transcribeVoice().
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

// ── Supported MIME types for inline_data (binary files) ──────────────────────
const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

// ── Category taxonomy the AI must assign to each rule ────────────────────────
const CATEGORIES = "scheduling, communication, safety, operations, quality, other";

// ── Extraction prompt ─────────────────────────────────────────────────────────
// Written in Hebrew to match the manager's working language.
// Strict JSON output enforced — no markdown prose allowed.
function buildExtractionPrompt(fileName: string, isText: boolean, textContent?: string): string {
  const docRef = isText
    ? `הטקסט הבא הופק מהמסמך "${fileName}":\n\n"""\n${textContent ?? ""}\n"""\n\n`
    : `המסמך המצורף הוא "${fileName}".\n\n`;

  return `${docRef}משימה: חלץ את כל כללי העבודה, הנהלים, והעדפות הניהול הכלולים במסמך זה.

הנחיות לחילוץ:
1. כל כלל חייב להיות משפט אחד קצר וברור בעברית (עד 150 תווים).
2. התמקד בהנחיות הניתנות לפעולה — לא בתיאורים כלליים.
3. השמט מידע ניהולי כללי שאינו ייחודי למחלקה זו.
4. סווג כל כלל לאחת מהקטגוריות הבאות בלבד (באנגלית כפי שכתוב): ${CATEGORIES}.
5. אם אין כללים ניתנים לחילוץ, החזר רשימה ריקה.

פורמט התשובה — JSON בלבד, ללא טקסט נוסף, ללא markdown:
{"rules": [{"rule_text": "...", "category": "..."}, ...]}`;
}

// ── Strip markdown fences and parse the rules JSON ────────────────────────────
function parseRulesJson(raw: string): Array<{ rule_text: string; category: string }> {
  // Remove possible markdown code fences (```json ... ```)
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?[\r\n]*/i, "")
    .replace(/[\r\n]*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Sometimes the model wraps in an outer object; try finding the array directly
    const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error("model_did_not_return_valid_json");
    parsed = { rules: JSON.parse(match[0]) };
  }

  const obj = parsed as Record<string, unknown>;

  // Accept both { rules: [...] } and a bare array
  const arr: unknown = Array.isArray(obj) ? obj : obj.rules;
  if (!Array.isArray(arr)) throw new Error("model_returned_no_rules_array");

  return arr
    .filter(
      (r): r is { rule_text: string; category: string } =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { rule_text?: unknown }).rule_text === "string" &&
        (r as { rule_text: string }).rule_text.trim().length > 0
    )
    .map((r) => ({
      rule_text: String(r.rule_text).trim().slice(0, 500), // hard cap per rule
      category:  String((r as { category?: unknown }).category ?? "other").toLowerCase().trim(),
    }));
}

// ── Gemini multimodal call ─────────────────────────────────────────────────────
// For binary files (PDF, images): sends inline_data alongside the prompt text.
// For pre-extracted text: sends only the text part (no inline_data).
async function callGemini(
  apiKey: string,
  fileName: string,
  mimeType: string,
  content: string, // base64 for binary; plain text for text
  isText: boolean
): Promise<string> {
  const parts: unknown[] = [];

  if (isText) {
    // Text content (TXT or mammoth-extracted DOCX) — no inline_data needed
    parts.push({ text: buildExtractionPrompt(fileName, true, content) });
  } else {
    // Binary file (PDF / image) — INSTRUCTION first, then PAYLOAD (Gemini best practice)
    if (!BINARY_MIME_TYPES.has(mimeType)) {
      throw new Error(`unsupported_mime_type: ${mimeType}`);
    }
    // Gemini review confirmed: text prompt BEFORE inline_data for best PDF parsing
    parts.push({ text: buildExtractionPrompt(fileName, false) });
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: content, // standard base64 (btoa output from browser)
      },
    });
  }

  const requestBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.0,       // zero temperature: absolute determinism for schema-strict extraction
      responseMimeType: "application/json", // instruct Gemini to return JSON directly
    },
  };

  let lastErr: Error | null = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60_000), // 60s — PDF parsing can be slow
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`gemini_http_${model}_${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data = await res.json();

      // Extract the text from the first candidate
      const text: string =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("") ?? "";

      if (!text.trim()) {
        // Check if content was filtered
        const finishReason = data?.candidates?.[0]?.finishReason;
        throw new Error(
          finishReason === "SAFETY"
            ? "gemini_safety_filter: content blocked"
            : `gemini_empty_response_${model}`
        );
      }

      return text;
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[process-knowledge] model="${model}" failed:`, lastErr.message);
    }
  }
  throw lastErr ?? new Error("gemini_no_models_available");
}

// ── Main handler ───────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── 1. Parse and validate request body ─────────────────────────────────
    let body: {
      fileName?: unknown;
      mimeType?: unknown;
      content?: unknown;
      isText?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      throw new Error("request_body_must_be_json");
    }

    const fileName  = String(body.fileName  ?? "").trim();
    const mimeType  = String(body.mimeType  ?? "").trim().toLowerCase();
    const content   = String(body.content   ?? "").trim();
    const isText    = Boolean(body.isText);

    if (!fileName)  throw new Error("missing_field: fileName");
    if (!mimeType)  throw new Error("missing_field: mimeType");
    if (!content)   throw new Error("missing_field: content (file is empty)");

    // Guard: reject obviously oversized payloads (base64 of a 15MB file ≈ 20MB string)
    const contentBytes = content.length; // rough byte count
    const MAX_CONTENT_BYTES = 22 * 1024 * 1024; // 22 MB string length limit
    if (contentBytes > MAX_CONTENT_BYTES) {
      throw new Error(
        `file_too_large: content is ${Math.round(contentBytes / 1024 / 1024)}MB, max is ~15MB`
      );
    }

    // ── 2. Authenticate the caller ──────────────────────────────────────────
    const bearer = req.headers.get("Authorization") ?? "";
    const token  = bearer.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("unauthorized: missing Bearer token");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authErr || !user) {
      throw new Error(`unauthorized: ${authErr?.message ?? "invalid token"}`);
    }

    const managerId = user.id;
    console.log("[process-knowledge] manager:", managerId, "file:", fileName);

    // ── 3. Fetch manager's department — server-side, not trusted from client ──
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("department")
      .eq("id", managerId)
      .single();

    if (profileErr || !profile?.department) {
      throw new Error(
        "profile_no_department: manager must select a department before uploading knowledge"
      );
    }

    const department: string = profile.department;
    console.log("[process-knowledge] department:", department);

    // ── 4. Call Gemini 1.5 Flash for multimodal extraction ─────────────────
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("server_config: GEMINI_API_KEY not set");

    let rawResponse: string;
    try {
      rawResponse = await callGemini(apiKey, fileName, mimeType, content, isText);
      console.log("[process-knowledge] Gemini raw response length:", rawResponse.length);
    } catch (geminiErr) {
      console.error("[process-knowledge] Gemini error:", (geminiErr as Error).message);
      throw new Error(
        `gemini_extraction_failed: ${(geminiErr as Error).message}`
      );
    }

    // ── 5. Parse the extracted rules JSON ───────────────────────────────────
    let rules: Array<{ rule_text: string; category: string }>;
    try {
      rules = parseRulesJson(rawResponse);
    } catch (parseErr) {
      console.error("[process-knowledge] JSON parse error:", (parseErr as Error).message);
      console.error("[process-knowledge] Raw response was:", rawResponse.slice(0, 500));
      throw new Error(`extraction_parse_failed: ${(parseErr as Error).message}`);
    }

    if (rules.length === 0) {
      // Not an error — the document may have no actionable rules.
      // Return success with empty array so the UI can show a friendly message.
      console.log("[process-knowledge] No rules extracted from:", fileName);
      return new Response(
        JSON.stringify({ ok: true, rules_extracted: 0, rules: [] }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    console.log("[process-knowledge] extracted", rules.length, "rules");

    // ── 6. Batch INSERT rules into agent_memory ─────────────────────────────
    const rows = rules.map((r) => ({
      manager_id:       managerId,
      department:       department,
      rule_text:        r.rule_text,
      source_file_name: fileName,
      category:         r.category,
      is_active:        true,
    }));

    const { error: insertErr } = await supabase.from("agent_memory").insert(rows);

    if (insertErr) {
      console.error("[process-knowledge] DB insert error:", insertErr.message, insertErr.details);
      throw new Error(`db_insert_failed: ${insertErr.message}`);
    }

    console.log("[process-knowledge] inserted", rows.length, "rows for manager", managerId);

    // ── 7. Return extracted rules to frontend for live preview ──────────────
    return new Response(
      JSON.stringify({
        ok:             true,
        rules_extracted: rules.length,
        rules,                  // returned for UI preview — not re-fetched from DB
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = (err instanceof Error) ? err.message : String(err);
    console.error("[process-knowledge] fatal error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
