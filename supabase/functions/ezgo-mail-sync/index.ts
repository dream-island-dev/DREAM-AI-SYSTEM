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
  parseAllowlist,
  resolveEzgoImapConfig,
  type EzgoMailExcelAttachment,
  type EzgoInboundMail,
} from "../_shared/ezgoMailImap.ts";
import {
  enrichRecordsPhoneFromDb,
  loadGuestCacheForReport,
  matchDoc1Record,
} from "../_shared/ezgoMailMatch.ts";

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

async function resolveDoc1FromMessage(msg: {
  bodyHtml: string;
  bodyText: string;
  excelAttachments?: EzgoMailExcelAttachment[];
}): Promise<{ classified: EzgoMailClassification; records: Doc1Record[] }> {
  const opts = defaultDoc1ParseOpts(true);
  let classified = classifyEzgoMailContent(msg.bodyHtml, msg.bodyText);
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

  return { classified, records };
}

async function processIngest(
  supabase: ReturnType<typeof createClient>,
  msg: {
    id: string;
    fromEmail: string;
    fromName: string | null;
    subject: string;
    receivedAt: string;
    bodyPreview: string;
    bodyText: string;
    bodyHtml: string;
    excelAttachments?: EzgoMailExcelAttachment[];
  },
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

  const { classified, records } = await resolveDoc1FromMessage(msg);
  if (classified.reportType === "unknown" && !records.length) {
    const { data: skipped } = await supabase.from("ezgo_mail_ingest").insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: "unknown",
      parse_status: "skipped",
      parse_error: "לא זוהה דוח EZGO (Doc1 HTML/טבלה/Excel)",
      body_preview: msg.bodyPreview,
      ...bodySnapshot,
    }).select("id").maybeSingle();
    return { ok: true, ingestId: skipped?.id, reason: "unknown_format" };
  }

  if (!records.length) {
    const { data: failed } = await supabase.from("ezgo_mail_ingest").insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: classified.reportType,
      parse_status: "failed",
      parse_error: "לא נמצאו שורות הזמנה בדוח",
      body_preview: msg.bodyPreview,
      ...bodySnapshot,
    }).select("id").maybeSingle();
    return { ok: false, ingestId: failed?.id, reason: "no_rows" };
  }

  records = await enrichRecordsPhoneFromDb(supabase, records);

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
      report_type: classified.reportType,
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

  const lineRows = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Doc1Record;
    const match = await matchDoc1Record(supabase, rec, guestCache, reportDate);
    lineRows.push({
      ingest_id: ingest.id,
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
  if (linesErr) {
    await supabase.from("ezgo_mail_ingest").update({
      parse_status: "failed",
      parse_error: linesErr.message,
    }).eq("id", ingest.id);
    return { ok: false, reason: linesErr.message };
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

  const { error: delErr } = await supabase
    .from("ezgo_mail_ingest")
    .delete()
    .eq("id", ingestId);
  if (delErr) return { ok: false, reason: delErr.message };

  return await processIngest(supabase, msg);
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

    let body: { reparse_ingest_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (!ezgoMailSyncEnabled()) {
      return jsonResponse({ ok: true, skipped: true, reason: "EZGO_MAIL_SYNC_ENABLED=false" });
    }

    const cfg = resolveEzgoImapConfig();
    if (!cfg) {
      return jsonResponse({ ok: false, error: "EZGO_MAIL_IMAP not configured" });
    }

    const allowlist = parseAllowlist();

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

    const { messages, meta: imapMeta } = await withImapBudget(() =>
      fetchEzgoInboxMessages(cfg, 36, allowlist)
    );

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const details: Array<{ id: string; result: string }> = [];

    for (const msg of messages) {
      if (!isSenderAllowed(msg.fromEmail, allowlist)) {
        skipped += 1;
        continue;
      }

      try {
        const result = await processIngest(supabase, msg);
        if (result.reason === "duplicate") skipped += 1;
        else if (result.ok) processed += 1;
        else failed += 1;
        details.push({ id: msg.id, result: result.reason ?? (result.ok ? "ok" : "fail") });
      } catch (err) {
        failed += 1;
        details.push({ id: msg.id, result: (err as Error).message });
      }
    }

    return jsonResponse({
      ok: true,
      processed,
      skipped,
      failed,
      scanned: messages.length,
      imap: imapMeta,
      details: details.slice(0, 10),
    });
  } catch (e) {
    console.error("[ezgo-mail-sync]", e);
    return jsonResponse({ ok: false, error: (e as Error).message });
  }
});
