import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyEzgoMailContent,
  countDoc1RecordsMissingPhone,
  defaultDoc1ParseOpts,
  mergeDoc1PhoneFromSecondary,
  parseDoc1FromClassification,
  parseDoc1FromExcelBuffer,
  type Doc1Record,
  type EzgoMailClassification,
} from "../_shared/ezgoDoc1Parser.ts";
import {
  ezgoMailSyncEnabled,
  fetchEzgoInboxMessages,
  fetchEzgoMessageById,
  isSenderAllowed,
  normalizeMessageId,
  parseAllowlist,
  parseEmlSourceToInboundMail,
  resolveEzgoImapConfig,
  type EzgoMailExcelAttachment,
  type EzgoInboundMail,
} from "../_shared/ezgoMailImap.ts";
import {
  parseDoc2FromClassification,
  type Doc2Record,
} from "../_shared/ezgoDoc2Parser.ts";
import { matchDoc2Record } from "../_shared/ezgoDoc2MailMatch.ts";
import {
  enrichRecordsPhoneFromDb,
  loadGuestCacheForReport,
  matchDoc1Record,
} from "../_shared/ezgoMailMatch.ts";

type MailResolveResult =
  | { kind: "doc1"; classified: EzgoMailClassification; records: Doc1Record[] }
  | { kind: "doc2"; classified: EzgoMailClassification; records: Doc2Record[] }
  | { kind: "unknown"; classified: EzgoMailClassification; records: [] };

function ingestReportType(classified: EzgoMailClassification): string {
  if (classified.reportType === "doc2_html") return "doc2_arrivals";
  return classified.reportType;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const IMAP_BUDGET_MS = 55_000;

async function loadKnownMessageIds(
  supabase: ReturnType<typeof createClient>,
): Promise<Set<string>> {
  const since = new Date();
  since.setDate(since.getDate() - 35);
  const { data, error } = await supabase
    .from("ezgo_mail_ingest")
    .select("external_message_id")
    .gte("received_at", since.toISOString());
  if (error) {
    console.warn("[ezgo-mail-sync] known ids lookup failed:", error.message);
    return new Set();
  }
  const ids = new Set<string>();
  for (const row of data || []) {
    const id = normalizeMessageId(row.external_message_id);
    if (id) ids.add(id);
  }
  return ids;
}

function resolveEzgoMailRetentionDays(): number {
  const raw = Number(Deno.env.get("EZGO_MAIL_RETENTION_DAYS") || "3");
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.min(Math.floor(raw), 30);
}

async function purgeStaleEzgoMailIngest(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const retentionDays = resolveEzgoMailRetentionDays();
  const { data, error } = await supabase.rpc("purge_stale_ezgo_mail_ingest", {
    retention_days: retentionDays,
  });
  if (error) {
    console.warn("[ezgo-mail-sync] purge failed:", error.message);
    return 0;
  }
  const purged = Number(data) || 0;
  if (purged > 0) {
    console.log(`[ezgo-mail-sync] purged ${purged} stale ingests (>${retentionDays}d)`);
  }
  return purged;
}

async function withImapBudget<T>(fn: () => Promise<T>): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error("IMAP timeout — נסה שוב בעוד דקה או המתן ל-cron")),
        IMAP_BUDGET_MS,
      );
    }),
  ]);
}

async function assertEzgoMailStaff(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // whatsapp-cron invokes with service role — skip user gate.
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;

  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "נדרשת התחברות" }, 401);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ ok: false, error: "סשן לא תקין — התחבר מחדש" }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.status === "suspended") {
    return jsonResponse({ ok: false, error: "אין הרשאה" }, 403);
  }
  if (!["super_admin", "admin", "manager", "staff"].includes(String(profile.role || ""))) {
    return jsonResponse({ ok: false, error: "אין הרשאה לסנכרון מייל EZGO" }, 403);
  }
  return null;
}

async function resolveEzgoMailFromMessage(msg: {
  bodyHtml: string;
  bodyText: string;
  excelAttachments?: EzgoMailExcelAttachment[];
}): Promise<MailResolveResult> {
  let classified = classifyEzgoMailContent(msg.bodyHtml, msg.bodyText);

  if (classified.reportType === "doc2_html") {
    const records = parseDoc2FromClassification(classified);
    return { kind: "doc2", classified, records };
  }

  const opts = defaultDoc1ParseOpts(true);
  let records = parseDoc1FromClassification(classified, opts);

  let excelRecords: Doc1Record[] = [];
  if (msg.excelAttachments?.length) {
    for (const att of msg.excelAttachments) {
      const parsed = await parseDoc1FromExcelBuffer(att.data, opts);
      if (parsed.length) {
        excelRecords = parsed;
        if (!records.length) {
          classified = { reportType: "doc1_excel", excelFilename: att.filename };
          records = parsed;
        }
        break;
      }
    }
  }

  if (records.length && excelRecords.length && countDoc1RecordsMissingPhone(records) > 0) {
    records = mergeDoc1PhoneFromSecondary(records, excelRecords);
  }

  if (!records.length && classified.reportType === "unknown") {
    return { kind: "unknown", classified, records: [] };
  }
  return { kind: "doc1", classified, records };
}

/** @deprecated use resolveEzgoMailFromMessage */
async function resolveDoc1FromMessage(msg: {
  bodyHtml: string;
  bodyText: string;
  excelAttachments?: EzgoMailExcelAttachment[];
}): Promise<{ classified: EzgoMailClassification; records: Doc1Record[] }> {
  const resolved = await resolveEzgoMailFromMessage(msg);
  if (resolved.kind === "doc2") {
    return { classified: resolved.classified, records: [] };
  }
  if (resolved.kind === "unknown") {
    return { classified: resolved.classified, records: [] };
  }
  return { classified: resolved.classified, records: resolved.records };
}

type IngestMsg = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
  bodyHtml: string;
  excelAttachments?: EzgoMailExcelAttachment[];
};

async function insertDoc1IngestLines(
  supabase: ReturnType<typeof createClient>,
  ingestId: string,
  records: Doc1Record[],
  reportDate: string | null,
  guestCache: Awaited<ReturnType<typeof loadGuestCacheForReport>>,
): Promise<{ ok: boolean; reason?: string }> {
  const lineRows = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Doc1Record;
    const match = await matchDoc1Record(supabase, rec, guestCache, reportDate);
    lineRows.push({
      ingest_id: ingestId,
      line_index: i,
      parsed_json: rec,
      match_guest_id: match.guest?.id ?? null,
      match_method: match.method === "none" ? null : match.method,
      match_confidence: match.confidence,
      match_label: match.label,
      action: match.action,
      proposed_patch: match.patch,
      status: "pending_review",
    });
  }

  const { error: linesErr } = await supabase.from("ezgo_mail_import_lines").insert(lineRows);
  if (linesErr) return { ok: false, reason: linesErr.message };
  return { ok: true };
}

async function insertDoc2IngestLines(
  supabase: ReturnType<typeof createClient>,
  ingestId: string,
  records: Doc2Record[],
  reportDate: string | null,
  guestCache: Awaited<ReturnType<typeof loadGuestCacheForReport>>,
): Promise<{ ok: boolean; reason?: string }> {
  const lineRows = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const match = await matchDoc2Record(supabase, rec, guestCache, reportDate);
    lineRows.push({
      ingest_id: ingestId,
      line_index: i,
      parsed_json: rec,
      match_guest_id: match.guest?.id ?? null,
      match_method: match.method === "none" ? null : match.method,
      match_confidence: match.confidence,
      match_label: match.label,
      action: match.action,
      proposed_patch: match.patch,
      status: "pending_review",
    });
  }

  const { error: linesErr } = await supabase.from("ezgo_mail_import_lines").insert(lineRows);
  if (linesErr) return { ok: false, reason: linesErr.message };
  return { ok: true };
}

async function insertIngestLines(
  supabase: ReturnType<typeof createClient>,
  ingestId: string,
  resolved: MailResolveResult & { records: Doc1Record[] | Doc2Record[] },
  reportDate: string | null,
  guestCache: Awaited<ReturnType<typeof loadGuestCacheForReport>>,
): Promise<{ ok: boolean; reason?: string }> {
  if (resolved.kind === "doc2") {
    return await insertDoc2IngestLines(
      supabase,
      ingestId,
      resolved.records,
      reportDate,
      guestCache,
    );
  }
  return await insertDoc1IngestLines(
    supabase,
    ingestId,
    resolved.records as Doc1Record[],
    reportDate,
    guestCache,
  );
}

/** Reparse in-place — never DELETE ingest row (prevents vanishing on IMAP miss). */
async function processIngestReplace(
  supabase: ReturnType<typeof createClient>,
  msg: IngestMsg,
  existingIngestId: string,
): Promise<{ ok: boolean; ingestId?: string; lines?: number; reason?: string }> {
  const bodySnapshot = {
    body_html: msg.bodyHtml?.slice(0, 500_000) || null,
    body_text: msg.bodyText?.slice(0, 12_000) || null,
  };

  const resolved = await resolveEzgoMailFromMessage(msg);
  const { classified } = resolved;
  if (resolved.kind === "unknown" && !resolved.records.length) {
    await supabase.from("ezgo_mail_ingest").update({
      parse_status: "skipped",
      parse_error: "לא זוהה דוח EZGO (Doc1/Doc2 HTML/טבלה/Excel)",
      report_type: "unknown",
      ...bodySnapshot,
    }).eq("id", existingIngestId);
    return { ok: true, ingestId: existingIngestId, reason: "unknown_format" };
  }

  if (!resolved.records.length) {
    await supabase.from("ezgo_mail_ingest").update({
      parse_status: "failed",
      parse_error: "לא נמצאו שורות הזמנה בדוח",
      report_type: ingestReportType(classified),
      ...bodySnapshot,
    }).eq("id", existingIngestId);
    return { ok: false, ingestId: existingIngestId, reason: "no_rows" };
  }

  let records = resolved.records;
  if (resolved.kind === "doc1") {
    records = await enrichRecordsPhoneFromDb(supabase, records as Doc1Record[]);
  }

  const reportDate = records.find((r) => r.arrival_date)?.arrival_date ?? null;
  const guestCache = await loadGuestCacheForReport(supabase, reportDate);

  await supabase.from("ezgo_mail_import_lines").delete().eq("ingest_id", existingIngestId);

  const { error: updErr } = await supabase.from("ezgo_mail_ingest").update({
    from_email: msg.fromEmail,
    from_name: msg.fromName,
    subject: msg.subject,
    received_at: msg.receivedAt,
    report_type: ingestReportType(classified),
    parse_status: "parsed",
    parse_error: null,
    report_date_ymd: reportDate,
    line_count: records.length,
    pending_count: records.length,
    body_preview: msg.bodyPreview,
    ...bodySnapshot,
  }).eq("id", existingIngestId);

  if (updErr) return { ok: false, reason: updErr.message };

  const linesResult = await insertIngestLines(
    supabase,
    existingIngestId,
    { ...resolved, records },
    reportDate,
    guestCache,
  );
  if (!linesResult.ok) {
    await supabase.from("ezgo_mail_ingest").update({
      parse_status: "failed",
      parse_error: linesResult.reason,
    }).eq("id", existingIngestId);
    return { ok: false, ingestId: existingIngestId, reason: linesResult.reason };
  }

  return { ok: true, ingestId: existingIngestId, lines: records.length };
}

async function processIngest(
  supabase: ReturnType<typeof createClient>,
  msg: IngestMsg,
): Promise<{ ok: boolean; ingestId?: string; lines?: number; reason?: string }> {
  const bodySnapshot = {
    body_html: msg.bodyHtml?.slice(0, 500_000) || null,
    body_text: msg.bodyText?.slice(0, 12_000) || null,
  };

  const { data: existing } = await supabase
    .from("ezgo_mail_ingest")
    .select("id")
    .eq("external_message_id", msg.id)
    .maybeSingle();
  if (existing) return { ok: true, reason: "duplicate" };

  const resolved = await resolveEzgoMailFromMessage(msg);
  const { classified } = resolved;
  if (resolved.kind === "unknown" && !resolved.records.length) {
    const { data: skipped } = await supabase.from("ezgo_mail_ingest").insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: "unknown",
      parse_status: "skipped",
      parse_error: "לא זוהה דוח EZGO (Doc1/Doc2 HTML/טבלה/Excel)",
      body_preview: msg.bodyPreview,
      ...bodySnapshot,
    }).select("id").maybeSingle();
    return { ok: true, ingestId: skipped?.id, reason: "unknown_format" };
  }

  if (!resolved.records.length) {
    const { data: failed } = await supabase.from("ezgo_mail_ingest").insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: ingestReportType(classified),
      parse_status: "failed",
      parse_error: "לא נמצאו שורות הזמנה בדוח",
      body_preview: msg.bodyPreview,
      ...bodySnapshot,
    }).select("id").maybeSingle();
    return { ok: false, ingestId: failed?.id, reason: "no_rows" };
  }

  let records = resolved.records;
  if (resolved.kind === "doc1") {
    records = await enrichRecordsPhoneFromDb(supabase, records as Doc1Record[]);
  }

  const reportDate = records.find((r) => r.arrival_date)?.arrival_date ?? null;
  const guestCache = await loadGuestCacheForReport(supabase, reportDate);

  const { data: ingest, error: ingestErr } = await supabase
    .from("ezgo_mail_ingest")
    .insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: ingestReportType(classified),
      parse_status: "parsed",
      report_date_ymd: reportDate,
      line_count: records.length,
      pending_count: records.length,
      body_preview: msg.bodyPreview,
      ...bodySnapshot,
    })
    .select("id")
    .maybeSingle();

  if (ingestErr || !ingest) {
    return { ok: false, reason: ingestErr?.message ?? "ingest_insert_failed" };
  }

  const linesResult = await insertIngestLines(
    supabase,
    ingest.id,
    { ...resolved, records },
    reportDate,
    guestCache,
  );
  if (!linesResult.ok) {
    await supabase.from("ezgo_mail_ingest").update({
      parse_status: "failed",
      parse_error: linesResult.reason,
    }).eq("id", ingest.id);
    return { ok: false, reason: linesResult.reason };
  }

  return { ok: true, ingestId: ingest.id, lines: records.length };
}

async function reparseIngest(
  supabase: ReturnType<typeof createClient>,
  ingestId: string,
  cfg: NonNullable<ReturnType<typeof resolveEzgoImapConfig>>,
  allowlist: string[],
): Promise<{ ok: boolean; ingestId?: string; lines?: number; reason?: string }> {
  const { data: ingest } = await supabase
    .from("ezgo_mail_ingest")
    .select(
      "id, external_message_id, subject, from_email, from_name, received_at, body_preview, body_html, body_text",
    )
    .eq("id", ingestId)
    .maybeSingle();
  if (!ingest) return { ok: false, reason: "ingest_not_found" };

  let msg: EzgoInboundMail | null = null;
  try {
    msg = await withImapBudget(() =>
      fetchEzgoMessageById(cfg, ingest.external_message_id, allowlist)
    );
  } catch (e) {
    console.warn("[ezgo-mail-sync] reparse IMAP lookup failed:", (e as Error).message);
  }

  if (!msg && ingest.body_html) {
    msg = {
      id: ingest.external_message_id,
      fromEmail: ingest.from_email,
      fromName: ingest.from_name,
      subject: ingest.subject,
      receivedAt: ingest.received_at,
      bodyPreview: ingest.body_preview || "",
      bodyText: ingest.body_text || "",
      bodyHtml: ingest.body_html,
      excelAttachments: [],
    };
  }

  if (!msg) {
    return {
      ok: false,
      reason:
        "המייל לא נמצא בתיבה ואין עותק שמור — הרץ «סנכרון מייל» לפני פרסור מחדש",
    };
  }

  return await processIngestReplace(supabase, msg, ingestId);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authBlock = await assertEzgoMailStaff(req, supabase);
    if (authBlock) return authBlock;

    let body: { reparse_ingest_id?: string; eml_base64?: string; full_sync?: boolean; manual?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (!ezgoMailSyncEnabled()) {
      return jsonResponse({ ok: true, skipped: true, reason: "EZGO_MAIL_SYNC_ENABLED=false" });
    }

    const allowlist = parseAllowlist();
    const cfg = resolveEzgoImapConfig();

    if (body.eml_base64) {
      try {
        const bin = Uint8Array.from(
          atob(String(body.eml_base64).replace(/\s/g, "")),
          (c) => c.charCodeAt(0),
        );
        const msg = await parseEmlSourceToInboundMail(bin, allowlist);
        if (!msg) {
          return jsonResponse({
            ok: false,
            error: "eml_parse_failed",
            reason: "לא נמצא דוח EZGO בקובץ או שולח לא מאושר",
          });
        }
        const result = await processIngest(supabase, msg);
        return jsonResponse({
          ok: result.ok,
          ingest_eml: true,
          imap_user: cfg?.user ?? null,
          ...result,
        });
      } catch (e) {
        console.error("[ezgo-mail-sync] eml ingest", e);
        return jsonResponse({ ok: false, error: (e as Error).message });
      }
    }

    if (!cfg) {
      return jsonResponse({ ok: false, error: "EZGO_MAIL_IMAP not configured" });
    }

    if (body.reparse_ingest_id) {
      try {
        const result = await reparseIngest(supabase, body.reparse_ingest_id, cfg, allowlist);
        return jsonResponse({
          ok: result.ok,
          reparse: true,
          ...result,
        });
      } catch (e) {
        console.error("[ezgo-mail-sync] reparse", e);
        return jsonResponse({ ok: false, error: (e as Error).message });
      }
    }

    const fullSync = body.full_sync === true;
    const manual = body.manual === true;
    const knownMessageIds = fullSync
      ? new Set<string>()
      : await loadKnownMessageIds(supabase);

    const { messages, meta: imapMeta } = await withImapBudget(() =>
      fetchEzgoInboxMessages(cfg, manual || fullSync ? 36 : 24, allowlist, {
        knownMessageIds,
        fullSync,
        manual,
      })
    );

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const bySender: Record<string, number> = {};
    const details: Array<{ id: string; from: string; result: string }> = [];

    for (const msg of messages) {
      bySender[msg.fromEmail] = (bySender[msg.fromEmail] || 0) + 1;
      if (!isSenderAllowed(msg.fromEmail, allowlist)) {
        skipped += 1;
        details.push({ id: msg.id, from: msg.fromEmail, result: "sender_blocked" });
        continue;
      }

      try {
        const result = await processIngest(supabase, msg);
        if (result.reason === "duplicate") skipped += 1;
        else if (result.ok) processed += 1;
        else failed += 1;
        details.push({
          id: msg.id,
          from: msg.fromEmail,
          result: result.reason ?? (result.ok ? "ok" : "fail"),
        });
      } catch (err) {
        failed += 1;
        details.push({ id: msg.id, from: msg.fromEmail, result: (err as Error).message });
      }
    }

    const purged = await purgeStaleEzgoMailIngest(supabase);

    return jsonResponse({
      ok: true,
      processed,
      skipped,
      failed,
      purged,
      scanned: messages.length,
      by_sender: bySender,
      imap: imapMeta,
      imap_user: cfg.user,
      details: details.slice(0, 15),
    });
  } catch (e) {
    console.error("[ezgo-mail-sync]", e);
    return jsonResponse({ ok: false, error: (e as Error).message });
  }
});
