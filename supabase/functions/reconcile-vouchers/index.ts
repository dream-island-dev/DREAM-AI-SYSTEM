// supabase/functions/reconcile-vouchers/index.ts
// ══════════════════════════════════════════════════════════════════════════════
// Voucher Reconciliation Engine (Yelena) — backend processing engine.
//
// Accepts the two source files for one reconciliation run as multipart/form-data:
//   - easygoFile   ("EasyGo Vouchers Report" — what staff actually booked)
//   - providerFile ("Provider Report" — the external provider's source of
//                    truth for what the guest paid for, e.g. Hightech Zone)
//   - providerName (text field — must match voucher_providers.provider_name)
//
// Mapping resolution (mirrors ArrivalImportPanel.js's _headerSignature/memory
// lookup, the ONLY existing precedent for import_mapping_memory in this repo —
// that table has never been read/written from an Edge Function before; it's
// always been the frontend's job. This function owns it instead because there
// is no review UI yet for this feature, see below):
//   1. An explicit `providerMapping`/`easygoMapping` JSON field in the request
//      (a human already reviewed and approved it — e.g. resubmission after a
//      review screen, or manual testing pre-UI) — used as-is and remembered.
//   2. A remembered mapping in import_mapping_memory for this exact header
//      shape (schema_key + sorted-header signature) — used as-is.
//   3. Neither — asks the existing suggest-import-mapping function (Gemini→
//      Claude) for a proposal and returns it for review. NOTHING is written
//      to the DB in this case. migration 049's own comment is explicit that
//      this table "never skips the human gate" — an unreviewed AI guess must
//      not silently become the matching rule for financial reconciliation
//      data. The review UI is listed as next-session work (CLAUDE.md §10
//      session 49); this keeps that door open instead of bypassing it.
//
// Once both sides have a resolved mapping, rows are parsed and inserted into
// voucher_provider_reports / voucher_easygo_records (each side gets its own
// import_batch UUID, generated here so it can be passed straight to the RPC),
// then run_voucher_reconciliation(provider_batch, easygo_batch) is invoked and
// its JSONB summary is returned unchanged plus row-insert counts.
//
// Requires a valid staff Authorization bearer (same gate as
// process-knowledge/index.ts) — this is an internal tool, not a public guest/
// employee portal like guest-portal-data or inventory-portal-submit, so unlike
// those this does NOT skip auth. Deployed --no-verify-jwt like every function
// in this repo; the auth check below is what actually enforces it.
// ══════════════════════════════════════════════════════════════════════════════

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX         from "https://esm.sh/xlsx@0.18.5";
import {
  assessVoucherParseQuality,
  csvUtf8BytesToMatrix,
  detectVoucherEasygoPreset,
  detectVoucherProviderPreset,
  estimateReconciliationJoin,
  filterEasygoRowsByProvider,
  filterVoucherDataRows,
  matrixRowsFromVoucherHeaderScan,
  matrixToVoucherRows,
  normalizeImportHeaderKey,
  normalizeVoucherNumber,
  normalizeVoucherIdDigits,
  type VoucherMapping,
  type VoucherRow,
} from "../_shared/voucherImport.ts";
import { resolveVoucherProviderProfile } from "../_shared/voucherProviderConfig.ts";
import {
  resolveVoucherStrategy,
  strategySummaryForApi,
} from "../_shared/voucherReconciliationStrategy.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "../_shared/nofshonitNationalId.ts";
import { buildVoucherQuantityAudit } from "../_shared/voucherQuantityAudit.ts";
import {
  heverPdfRowsToMatrix,
  parseHeverPolicePdfText,
} from "../_shared/voucherPdfParse.ts";
// pdf-parse@1.1.1 — same lib used in local probe script for חבר/השוטרים PDFs
import pdfParse from "npm:pdf-parse@1.1.1";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB per file — same order of magnitude as process-knowledge's guard
const INSERT_CHUNK_SIZE = 500;

// ══════════════════════════════════════════════════════════════════════════════
// §1  SCHEMA FIELD LISTS — mirror suggest-import-mapping's SCHEMAS.voucher_*
//     entries by hand (same Deno/browser-boundary convention as importMapper.js
//     mirroring that function's SCHEMAS — no shared module across functions).
// ══════════════════════════════════════════════════════════════════════════════
const PROVIDER_FIELDS = ["voucherNumber", "guestName", "packageType", "amount", "purchaseDate"] as const;
const EASYGO_FIELDS   = ["voucherNumber", "guestName", "phone", "orderNumber", "packageType", "amount", "arrivalDate"] as const;

type Mapping = VoucherMapping;
type Row     = Record<string, unknown>;

// ══════════════════════════════════════════════════════════════════════════════
// §2  SMALL PURE HELPERS — same conventions as ArrivalImportPanel.js's
//     _headerSignature/_parseDate/_sanitizeE164 (duplicated by hand across the
//     browser/Deno boundary, same as every other cross-boundary constant in
//     this repo).
// ══════════════════════════════════════════════════════════════════════════════

// Sorted, joined header signature — MUST match ArrivalImportPanel.js's
// _headerSignature exactly, or a header shape approved on one side would never
// be recognized as "remembered" by the other.
function headerSignature(headers: string[]): string {
  return [...headers].sort().join("␟");
}

const PHONE_LIKE_RE = /(\+?\d[\d\-. ]{6,}\d)/g;
function maskSampleValue(value: unknown): unknown {
  if (value == null) return value;
  const s = String(value);
  return s.replace(PHONE_LIKE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length <= 4) return m;
    return m.slice(0, Math.ceil(m.length / 2)) + "*".repeat(m.length - Math.ceil(m.length / 2));
  });
}

function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;
function toDateOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 40000) {
    const dt = new Date(Math.round((serial - 25569) * 86_400_000));
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  return null;
}

// Matches guests.phone's E.164 convention (CLAUDE.md §5) — best-effort only,
// no FK resolution to guests here (out of scope for this engine; voucher_easygo_records.
// guest_id stays NULL, same as any other column this function doesn't populate).
function toE164OrNull(v: unknown): string | null {
  if (v == null) return null;
  const c = String(v).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? c : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  FILE PARSING — same library/version as package.json's frontend "xlsx"
//     dependency, used here purely as a buffer→rows reader (no filesystem
//     access), so no Deno-specific build target is needed.
// ══════════════════════════════════════════════════════════════════════════════
function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || file.type === "application/pdf";
}

async function pdfToMatrix(file: File, providerName: string | null): Promise<unknown[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await pdfParse(bytes);
  const text = String(parsed?.text ?? "");
  if (!text.trim()) throw new Error(`empty_pdf: "${file.name}" has no extractable text`);

  let rows = parseHeverPolicePdfText(text);
  const profile = providerName ? resolveVoucherProviderProfile(providerName) : null;
  if (profile?.pdfOrgFilter) {
    rows = rows.filter((r) => profile.pdfOrgFilter!.test(r.org));
  }
  if (!rows.length) {
    throw new Error(`empty_pdf: no voucher rows found in "${file.name}" for provider "${providerName ?? "?"}"`);
  }
  return heverPdfRowsToMatrix(rows);
}

function isCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || file.type === "text/csv";
}

function matrixFromWorkbook(bytes: Uint8Array, fileName: string): unknown[][] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`empty_workbook: "${fileName}" has no sheets`);
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (!matrix.length) throw new Error(`empty_sheet: "${fileName}" has no data rows`);
  return matrix;
}

async function parseUploadedFile(
  file: File,
  side: "provider" | "easygo",
  providerName: string | null = null,
): Promise<{ headers: string[]; rows: Row[]; mappingPreset: Mapping | null }> {
  if (file.size === 0) throw new Error(`empty_file: "${file.name}" has no content`);
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`file_too_large: "${file.name}" is ${Math.round(file.size / 1024 / 1024)}MB, max is ${MAX_FILE_BYTES / 1024 / 1024}MB`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const matrix = side === "provider" && isPdfFile(file)
    ? await pdfToMatrix(file, providerName)
    : isCsvFile(file)
      ? csvUtf8BytesToMatrix(bytes)
      : matrixFromWorkbook(bytes, file.name);

  const detectEasygo = (headers: string[]) => detectVoucherEasygoPreset(headers, providerName);
  const detectProvider = (headers: string[]) => {
    const sampleRows = matrix.slice(1, 12).map((row) => {
      const obj: VoucherRow = {};
      headers.forEach((h, col) => { obj[h] = (row as unknown[])?.[col] ?? ""; });
      return obj;
    });
    return detectVoucherProviderPreset(headers, sampleRows, providerName);
  };
  const detectPreset = side === "easygo" ? detectEasygo : detectProvider;

  const scanned = matrixRowsFromVoucherHeaderScan(matrix, detectPreset);
  if (scanned) {
    return { headers: scanned.headers, rows: scanned.rows as Row[], mappingPreset: detectPreset(scanned.headers) };
  }

  if (isCsvFile(file)) {
    const { headers, rows } = matrixToVoucherRows(matrix);
    const preset = detectPreset(headers);
    if (!rows.length) throw new Error(`empty_sheet: "${file.name}" has no data rows after CSV parse`);
    return { headers, rows: rows as Row[], mappingPreset: preset };
  }

  const headerCells = (matrix[0] ?? []).map((c) => normalizeImportHeaderKey(c));
  const preset = detectPreset(headerCells);
  if (preset) {
    const rows = matrix.slice(1).map((row) => {
      const obj: Row = {};
      headerCells.forEach((h, col) => { obj[h] = (row as unknown[])?.[col] ?? ""; });
      return obj;
    }).filter((row) => Object.values(row).some((v) => String(v ?? "").trim()));
    if (!rows.length) throw new Error(`empty_sheet: "${file.name}" has no data rows after header detection`);
    return { headers: headerCells, rows, mappingPreset: preset };
  }

  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`empty_workbook: "${file.name}" has no sheets`);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Row[];
  if (rows.length === 0) throw new Error(`empty_sheet: "${file.name}" has no data rows`);
  const normalized = rows.map((row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) out[normalizeImportHeaderKey(k)] = v;
    return out;
  });
  const headers = Object.keys(normalized[0] ?? {});
  return { headers, rows: normalized, mappingPreset: detectPreset(headers) };
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  MAPPING RESOLUTION — explicit (human-approved) → memory → AI proposal
//     (review-only, no write). See file header for the full rationale.
// ══════════════════════════════════════════════════════════════════════════════
type ResolvedMapping = { resolved: true; mapping: Mapping; source: "explicit" | "memory" | "preset" };
type PendingReview = {
  resolved: false;
  proposal: {
    domainLabel:     string;
    headers:         string[];
    sampleRows:      Row[];
    proposedMapping: Mapping;
    defaults:        Record<string, unknown>;
    confidence:      Record<string, string>;
    recommendations: string[];
    engine:          string;
  };
};

async function resolveSideMapping(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  schemaKey: "voucher_provider_report" | "voucher_easygo_report",
  domainLabel: string,
  headers: string[],
  rows: Row[],
  explicitMapping: Mapping | null,
  presetMapping: Mapping | null,
  providerName: string | null = null,
): Promise<ResolvedMapping | PendingReview> {
  const signature = headerSignature(headers);
  const profile = providerName ? resolveVoucherProviderProfile(providerName) : null;

  if (explicitMapping) {
    const { error } = await supabase.from("import_mapping_memory").upsert(
      { schema_key: schemaKey, header_signature: signature, approved_mapping: explicitMapping, last_used_at: new Date().toISOString() },
      { onConflict: "schema_key,header_signature" },
    );
    if (error) console.warn(`[reconcile-vouchers] failed to save mapping memory for ${schemaKey}:`, error.message);
    return { resolved: true, mapping: explicitMapping, source: "explicit" };
  }

  const { data: mem, error: memErr } = await supabase
    .from("import_mapping_memory")
    .select("approved_mapping")
    .eq("schema_key", schemaKey)
    .eq("header_signature", signature)
    .maybeSingle();
  if (memErr) console.warn(`[reconcile-vouchers] mapping memory lookup failed for ${schemaKey}:`, memErr.message);

  if (mem?.approved_mapping) {
    const memMapping = mem.approved_mapping as Mapping;
    const profileVoucher = profile?.easygoVoucherHeader;
    const staleEasygoMemory = schemaKey === "voucher_easygo_report"
      && profileVoucher
      && presetMapping?.voucherNumber === profileVoucher
      && memMapping.voucherNumber
      && memMapping.voucherNumber !== profileVoucher;

    if (staleEasygoMemory) {
      console.warn(
        `[reconcile-vouchers] overriding stale easygo mapping memory (${memMapping.voucherNumber} → ${profileVoucher}) for provider "${providerName}"`,
      );
      const { error } = await supabase.from("import_mapping_memory").upsert(
        { schema_key: schemaKey, header_signature: signature, approved_mapping: presetMapping, last_used_at: new Date().toISOString() },
        { onConflict: "schema_key,header_signature" },
      );
      if (error) console.warn(`[reconcile-vouchers] failed to refresh stale mapping for ${schemaKey}:`, error.message);
      return { resolved: true, mapping: presetMapping!, source: "preset" };
    }

    // Best-effort, non-blocking — a failed bump never blocks the import.
    supabase.from("import_mapping_memory")
      .update({ last_used_at: new Date().toISOString() })
      .eq("schema_key", schemaKey).eq("header_signature", signature)
      .then((res) => {
        if (res.error) console.warn(`[reconcile-vouchers] failed to bump last_used_at for ${schemaKey}:`, res.error.message);
      });
    return { resolved: true, mapping: mem.approved_mapping as Mapping, source: "memory" };
  }

  if (presetMapping?.voucherNumber) {
    const { error } = await supabase.from("import_mapping_memory").upsert(
      { schema_key: schemaKey, header_signature: signature, approved_mapping: presetMapping, last_used_at: new Date().toISOString() },
      { onConflict: "schema_key,header_signature" },
    );
    if (error) console.warn(`[reconcile-vouchers] failed to save preset mapping for ${schemaKey}:`, error.message);
    return { resolved: true, mapping: presetMapping, source: "preset" };
  }

  // No remembered mapping — ask suggest-import-mapping for a proposal. Sample
  // rows are masked the same way importMapper.js's buildMaskedSample does
  // before they leave for the AI call (phone-shaped values only — the model
  // only needs the column's shape, not the real value).
  const sampleRows = rows.slice(0, 3).map((row) => {
    const masked: Row = {};
    for (const h of headers) masked[h] = maskSampleValue(row[h]);
    return masked;
  });

  let proposal: { mapping: Mapping; defaults: Record<string, unknown>; recommendations: string[]; confidence: Record<string, string>; engine: string } | null = null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/suggest-import-mapping`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body:    JSON.stringify({ schemaKey, headers, sampleRows }),
      signal:  AbortSignal.timeout(25000),
    });
    const json = await res.json();
    if (json?.ok) {
      proposal = {
        mapping:         json.mapping ?? {},
        defaults:        json.defaults ?? {},
        recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
        confidence:      json.confidence ?? {},
        engine:          json.engine ?? "unknown",
      };
    } else {
      console.warn(`[reconcile-vouchers] suggest-import-mapping returned ok:false for ${schemaKey}:`, json?.error);
    }
  } catch (e) {
    console.warn(`[reconcile-vouchers] suggest-import-mapping call failed for ${schemaKey}:`, (e as Error).message);
  }

  return {
    resolved: false,
    proposal: {
      domainLabel,
      headers,
      sampleRows: rows.slice(0, 3), // unmasked — goes back to the calling staff member for review, never to an external model
      proposedMapping: proposal?.mapping ?? {},
      defaults:        proposal?.defaults ?? {},
      confidence:      proposal?.confidence ?? {},
      recommendations: proposal?.recommendations ?? ["הצעת AI לא הייתה זמינה — יש למפות ידנית ולשלוח מחדש עם מיפוי מפורש"],
      engine:          proposal?.engine ?? "none",
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  APPLY MAPPING — unmapped columns survive in raw_extras (Zero Data Loss,
//     CLAUDE.md §0.1) instead of being silently discarded.
// ══════════════════════════════════════════════════════════════════════════════
function extractFields(row: Row, mapping: Mapping, fields: readonly string[]): { fields: Row; extras: Row } {
  const out: Row = {};
  const used = new Set<string>();
  for (const f of fields) {
    const header = mapping[f];
    if (header && header in row) {
      out[f] = row[header];
      used.add(header);
    } else {
      out[f] = null;
    }
  }
  const extras: Row = {};
  for (const [h, v] of Object.entries(row)) {
    if (!used.has(h) && v !== "" && v != null) extras[h] = v;
  }
  return { fields: out, extras };
}

// ══════════════════════════════════════════════════════════════════════════════
// §6  HANDLER
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method !== "POST") throw new Error("method_not_allowed: use POST with multipart/form-data");

    // ── 1. Authenticate the caller — internal staff tool, not a public portal ──
    const bearer = req.headers.get("Authorization") ?? "";
    const token  = bearer.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("unauthorized: missing Bearer token");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase    = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authErr || !user) throw new Error(`unauthorized: ${authErr?.message ?? "invalid token"}`);

    // ── 2. Read the multipart payload ──────────────────────────────────────
    const form = await req.formData();
    const easygoFile   = form.get("easygoFile");
    const providerFile = form.get("providerFile");
    const providerName = cleanStr(form.get("providerName"));

    if (!(easygoFile instanceof File))   throw new Error("missing_field: easygoFile (the EasyGo Vouchers Report)");
    if (!(providerFile instanceof File)) throw new Error("missing_field: providerFile (the external Provider Report)");
    if (!providerName)                   throw new Error("missing_field: providerName");

    const rawProviderMapping = form.get("providerMapping");
    const rawEasygoMapping   = form.get("easygoMapping");
    let explicitProviderMapping: Mapping | null = null;
    let explicitEasygoMapping:   Mapping | null = null;
    try {
      if (typeof rawProviderMapping === "string" && rawProviderMapping.trim()) explicitProviderMapping = JSON.parse(rawProviderMapping);
      if (typeof rawEasygoMapping === "string" && rawEasygoMapping.trim())     explicitEasygoMapping   = JSON.parse(rawEasygoMapping);
    } catch {
      throw new Error("invalid_field: providerMapping/easygoMapping must be valid JSON when supplied");
    }

    // ── 3. Resolve the provider (data-driven registry, migration 091 §1) ──────
    const { data: providerRow, error: providerErr } = await supabase
      .from("voucher_providers")
      .select("id, provider_name, match_mode")
      .ilike("provider_name", providerName)
      .maybeSingle();
    if (providerErr) throw new Error(`provider_lookup_error: ${providerErr.message}`);
    if (!providerRow) {
      const { data: known } = await supabase.from("voucher_providers").select("provider_name").eq("is_active", true);
      const knownList = (known ?? []).map((p: { provider_name: string }) => p.provider_name).join(", ");
      throw new Error(`unknown_provider: "${providerName}" not found in voucher_providers. Known providers: ${knownList || "(none registered)"}`);
    }

    // ── 4. Parse both files ────────────────────────────────────────────────
    const providerParsed = await parseUploadedFile(providerFile, "provider", providerName);
    const easygoParsed   = await parseUploadedFile(easygoFile, "easygo", providerName);

    // ── 5. Resolve column mapping for each side ────────────────────────────
    const providerResolution = await resolveSideMapping(
      supabase, supabaseUrl, anonKey,
      "voucher_provider_report", "דוחות שוברים מספקים חיצוניים",
      providerParsed.headers, providerParsed.rows, explicitProviderMapping, providerParsed.mappingPreset,
      providerRow.provider_name,
    );
    const easygoResolution = await resolveSideMapping(
      supabase, supabaseUrl, anonKey,
      "voucher_easygo_report", "דוח השוברים של EasyGo",
      easygoParsed.headers, easygoParsed.rows, explicitEasygoMapping, easygoParsed.mappingPreset,
      providerRow.provider_name,
    );

    if (!providerResolution.resolved || !easygoResolution.resolved) {
      // Human-approval gate (see file header) — no rows are written, no
      // reconciliation runs. The caller resubmits with providerMapping/
      // easygoMapping once a person has reviewed the proposal(s) below.
      const review: Record<string, unknown> = {};
      if (!providerResolution.resolved) review.provider = providerResolution.proposal;
      if (!easygoResolution.resolved)   review.easygo   = easygoResolution.proposal;
      return new Response(
        JSON.stringify({ ok: true, status: "needs_mapping_review", review }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── 6. Apply mapping + build insert rows ───────────────────────────────
    const providerBatch = crypto.randomUUID();
    const easygoBatch    = crypto.randomUUID();

    const providerFiltered = filterVoucherDataRows(providerParsed.rows, providerResolution.mapping);
    const easygoCompanyFiltered = filterEasygoRowsByProvider(easygoParsed.rows, providerRow.provider_name);
    const easygoFiltered   = filterVoucherDataRows(easygoCompanyFiltered, easygoResolution.mapping);

    if (!easygoFiltered.length) {
      throw new Error(
        `parse_quality: לא נמצאו שורות איזיגו לספק "${providerRow.provider_name}" — בדוק שחברת השוברים בדוח תואמת`,
      );
    }

    const providerQuality = assessVoucherParseQuality(providerFiltered, providerResolution.mapping);
    const easygoQuality   = assessVoucherParseQuality(easygoFiltered, easygoResolution.mapping);
    if (!providerQuality.ok || !easygoQuality.ok) {
      const msgs = [providerQuality.message, easygoQuality.message].filter(Boolean);
      throw new Error(`parse_quality: ${msgs.join(" · ")}`);
    }

    const strategy = resolveVoucherStrategy(providerRow.provider_name);
    const isNofshonit = strategy?.key === "Nofshonit";
    const nofshonitIndex = isNofshonit
      ? buildNofshonitEasygoIndex(easygoCompanyFiltered)
      : null;

    const providerForJoin = nofshonitIndex
      ? providerFiltered.map((row) => {
          const vCol = providerResolution.mapping.voucherNumber!;
          const raw = row[vCol];
          const { nationalId } = resolveNofshonitProviderToNationalId(
            raw,
            nofshonitIndex.couponToNationalId,
            nofshonitIndex.byNationalId,
          );
          return nationalId ? { ...row, [vCol]: nationalId } : row;
        })
      : providerFiltered;

    const joinEstimate = estimateReconciliationJoin(
      providerForJoin,
      easygoFiltered,
      providerResolution.mapping,
      easygoResolution.mapping,
      providerRow.match_mode,
    );
    if (!joinEstimate.ok) {
      throw new Error(`parse_quality: ${joinEstimate.warning}`);
    }

    const providerRowsToInsert = providerFiltered.map((row) => {
      const { fields, extras } = extractFields(row, providerResolution.mapping, PROVIDER_FIELDS);
      const purchaseDate = toDateOrNull(fields.purchaseDate);
      if (fields.purchaseDate && !purchaseDate) extras._unparsed_purchaseDate = fields.purchaseDate;

      let voucherNumber = normalizeVoucherNumber(fields.voucherNumber);
      if (nofshonitIndex && fields.voucherNumber != null && String(fields.voucherNumber).trim()) {
        const rawId = String(fields.voucherNumber).trim();
        const { nationalId, resolvedFrom } = resolveNofshonitProviderToNationalId(
          rawId,
          nofshonitIndex.couponToNationalId,
          nofshonitIndex.byNationalId,
        );
        if (nationalId) {
          extras._provider_client_id = rawId;
          if (resolvedFrom === "coupon_lookup") extras._provider_coupon_no = rawId;
          else if (nofshonitIndex.couponToNationalId.has(normalizeVoucherIdDigits(rawId))) {
            extras._provider_coupon_no = rawId;
          } else if (resolvedFrom === "direct_tz" && rawId !== nationalId) {
            extras._provider_original_id = rawId;
          }
          voucherNumber = nationalId;
        }
      }

      return {
        import_batch:     providerBatch,
        provider_id:      providerRow.id,
        voucher_number:   voucherNumber,
        guest_name:       cleanStr(fields.guestName),
        package_type:     cleanStr(fields.packageType),
        amount:           toNumberOrNull(fields.amount),
        purchase_date:    purchaseDate,
        raw_extras:       Object.keys(extras).length ? extras : null,
        source_file_name: providerFile.name,
        created_by:       user.id,
      };
    });

    const easygoRowsToInsert = easygoFiltered.map((row) => {
      const { fields, extras } = extractFields(row, easygoResolution.mapping, EASYGO_FIELDS);
      const arrivalDate = toDateOrNull(fields.arrivalDate);
      if (fields.arrivalDate && !arrivalDate) extras._unparsed_arrivalDate = fields.arrivalDate;

      const couponNo = cleanStr(row["CouponNo"] ?? extras.CouponNo);
      if (couponNo) extras.CouponNo = couponNo;

      const voucherNumber = isNofshonit
        ? normalizeVoucherIdDigits(String(fields.voucherNumber ?? row["מזהה"] ?? "")) || null
        : normalizeVoucherNumber(fields.voucherNumber);

      return {
        import_batch:     easygoBatch,
        provider_id:      null, // intentionally unset — run_voucher_reconciliation tries every relevant provider when NULL (migration 091 §3 comment)
        voucher_number:   voucherNumber,
        guest_name:       cleanStr(fields.guestName),
        phone:            toE164OrNull(fields.phone),
        order_number:     cleanStr(fields.orderNumber),
        package_type:     cleanStr(fields.packageType),
        amount:           toNumberOrNull(fields.amount),
        arrival_date:     arrivalDate,
        raw_extras:       Object.keys(extras).length ? extras : null,
        source_file_name: easygoFile.name,
        created_by:       user.id,
      };
    });

    // ── 7. Store ────────────────────────────────────────────────────────────
    for (const batch of chunk(providerRowsToInsert, INSERT_CHUNK_SIZE)) {
      const { error } = await supabase.from("voucher_provider_reports").insert(batch);
      if (error) throw new Error(`provider_insert_error: ${error.message}`);
    }
    for (const batch of chunk(easygoRowsToInsert, INSERT_CHUNK_SIZE)) {
      const { error } = await supabase.from("voucher_easygo_records").insert(batch);
      if (error) throw new Error(`easygo_insert_error: ${error.message}`);
    }

    // ── 8. Execute reconciliation ───────────────────────────────────────────
    const { data: reconciliation, error: rpcErr } = await supabase.rpc("run_voucher_reconciliation", {
      p_provider_batch: providerBatch,
      p_easygo_batch:   easygoBatch,
    });
    if (rpcErr) throw new Error(`reconciliation_error: ${rpcErr.message}`);

    const quantityAudit = buildVoucherQuantityAudit(
      easygoRowsToInsert,
      providerRowsToInsert,
    );
    const quantityIssues = quantityAudit.filter((l) => l.status !== "ok");

    return new Response(
      JSON.stringify({
        ok:             true,
        status:         "complete",
        provider:       { id: providerRow.id, name: providerRow.provider_name, matchMode: providerRow.match_mode },
        providerBatch,
        easygoBatch,
        rowsInserted:   { provider: providerRowsToInsert.length, easygo: easygoRowsToInsert.length },
        mappingSource:  { provider: providerResolution.source, easygo: easygoResolution.source },
        parseQuality:   { provider: providerQuality.parsedRatio, easygo: easygoQuality.parsedRatio },
        joinEstimate:   {
          hitRate: joinEstimate.hitRate,
          providerHits: joinEstimate.providerHits,
          providerSample: joinEstimate.providerSample,
          packageMismatches: joinEstimate.packageMismatches,
        },
        strategy:       strategy ? strategySummaryForApi(strategy) : null,
        reconciliation: {
          ...reconciliation,
          quantity_audit: quantityAudit,
          quantity_issues: quantityIssues.length,
        },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reconcile-vouchers] error:", msg);
    // ⚠️ Always HTTP 200 (CLAUDE.md §6/§9 convention) — so supabase-js/fetch
    // callers get a parseable body with `error` instead of a generic non-2xx wrapper.
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
