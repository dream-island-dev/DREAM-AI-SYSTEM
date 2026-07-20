import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyEzgoMailContent,
  defaultDoc1ParseOpts,
  parseDoc1FromClassification,
  type Doc1Record,
} from "../_shared/ezgoDoc1Parser.ts";
import {
  ezgoMailSyncEnabled,
  fetchEzgoInboxMessages,
  isSenderAllowed,
  parseAllowlist,
  resolveEzgoImapConfig,
} from "../_shared/ezgoMailImap.ts";
import {
  loadGuestCacheForReport,
  matchDoc1Record,
} from "../_shared/ezgoMailMatch.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  },
): Promise<{ ok: boolean; ingestId?: string; lines?: number; reason?: string }> {
  const { data: existing } = await supabase
    .from("ezgo_mail_ingest")
    .select("id")
    .eq("external_message_id", msg.id)
    .maybeSingle();
  if (existing) return { ok: true, reason: "duplicate" };

  const classified = classifyEzgoMailContent(msg.bodyHtml, msg.bodyText);
  if (classified.reportType === "unknown") {
    const { data: skipped } = await supabase.from("ezgo_mail_ingest").insert({
      external_message_id: msg.id,
      from_email: msg.fromEmail,
      from_name: msg.fromName,
      subject: msg.subject,
      received_at: msg.receivedAt,
      report_type: "unknown",
      parse_status: "skipped",
      parse_error: "לא זוהה דוח EZGO (Doc1 HTML/טבלה)",
      body_preview: msg.bodyPreview,
    }).select("id").maybeSingle();
    return { ok: true, ingestId: skipped?.id, reason: "unknown_format" };
  }

  const records = parseDoc1FromClassification(classified, defaultDoc1ParseOpts(true));
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
    }).select("id").maybeSingle();
    return { ok: false, ingestId: failed?.id, reason: "no_rows" };
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
      report_type: classified.reportType,
      parse_status: "parsed",
      report_date_ymd: reportDate,
      line_count: records.length,
      pending_count: records.length,
      body_preview: msg.bodyPreview,
    })
    .select("id")
    .maybeSingle();

  if (ingestErr || !ingest) {
    return { ok: false, reason: ingestErr?.message ?? "ingest_insert_failed" };
  }

  const lineRows = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Doc1Record;
    const match = await matchDoc1Record(supabase, rec, guestCache);
    lineRows.push({
      ingest_id: ingest.id,
      line_index: i,
      parsed_json: rec,
      match_guest_id: match.guest?.id ?? null,
      match_method: match.method === "none" ? null : match.method,
      match_confidence: match.confidence,
      match_label: match.label,
      action: match.action === "no_match" ? "no_match" : match.action,
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!ezgoMailSyncEnabled()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "EZGO_MAIL_SYNC_ENABLED=false" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const cfg = resolveEzgoImapConfig();
    if (!cfg) {
      return new Response(JSON.stringify({ ok: false, error: "EZGO_MAIL_IMAP not configured" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const allowlist = parseAllowlist();
    const messages = await fetchEzgoInboxMessages(cfg, 40);

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

    return new Response(JSON.stringify({
      ok: true,
      processed,
      skipped,
      failed,
      scanned: messages.length,
      details: details.slice(0, 10),
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ezgo-mail-sync]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
