// supabase/functions/_shared/guestHallucinationAudit.ts
// Weekly regression audit — sample FAQ prompts vs handoff / KB grounding.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { GUEST_STAFF_HANDOFF_SENTENCE } from "./guestBotHandoff.ts";
import { retrieveGuestKnowledge, looksLikeFactualResortQuestion } from "./guestRag.ts";

/** Canonical FAQ probes — extend as resort policies change. */
export const HALLUCINATION_AUDIT_PROBES: Array<{ id: string; question: string; expectHandoff?: boolean }> = [
  { id: "checkin_hours", question: "באיזו שעה צ'ק-אין?" },
  { id: "pool_hours", question: "מתי הבריכה פתוחה?" },
  { id: "wifi", question: "מה הסיסמה ל-WiFi?" },
  { id: "rooftop_bar", question: "יש לכם בר על הגג?", expectHandoff: true },
  { id: "helicopter", question: "אפשר להזמין מסוק מהמלון?", expectHandoff: true },
  { id: "spa_booking", question: "איך מזמינים טיפול בספא?" },
  { id: "checkout", question: "באיזו שעה צ'ק-אאוט?" },
  { id: "pets", question: "מותר להביא כלב?", expectHandoff: true },
];

export type HallucinationAuditRow = {
  probe_id: string;
  question: string;
  rag_confidence: number;
  rag_chunk_count: number;
  expect_handoff: boolean;
  low_confidence: boolean;
  passed: boolean;
};

export type HallucinationAuditReport = {
  run_at: string;
  total: number;
  passed: number;
  failed: number;
  rows: HallucinationAuditRow[];
};

/**
 * Runs deterministic KB/RAG probes — no LLM call (zero token cost).
 * Flags probes where factual questions have zero RAG hits (would risk hallucination).
 */
export function runHallucinationAuditProbes(knowledgeBase: string): HallucinationAuditReport {
  const rows: HallucinationAuditRow[] = [];

  for (const probe of HALLUCINATION_AUDIT_PROBES) {
    const rag = retrieveGuestKnowledge(knowledgeBase, probe.question);
    const expectHandoff = probe.expectHandoff === true;
    const lowConfidence = looksLikeFactualResortQuestion(probe.question)
      && rag.confidence < 0.12
      && !expectHandoff;

    const passed = expectHandoff
      ? rag.confidence < 0.2
      : rag.chunks.length > 0 || rag.confidence >= 0.12;

    rows.push({
      probe_id: probe.id,
      question: probe.question,
      rag_confidence: rag.confidence,
      rag_chunk_count: rag.chunks.length,
      expect_handoff: expectHandoff,
      low_confidence: lowConfidence,
      passed,
    });
  }

  const passed = rows.filter((r) => r.passed).length;
  return {
    run_at: new Date().toISOString(),
    total: rows.length,
    passed,
    failed: rows.length - passed,
    rows,
  };
}

/** Persist audit summary to bot_config for ACC / BotSettings visibility. */
export async function persistHallucinationAuditReport(
  supabase: SupabaseClient,
  report: HallucinationAuditReport,
): Promise<void> {
  const summary = JSON.stringify({
    run_at: report.run_at,
    passed: report.passed,
    failed: report.failed,
    total: report.total,
    failed_probes: report.rows.filter((r) => !r.passed).map((r) => r.probe_id),
  });

  await supabase.from("bot_config").upsert(
    [
      { config_key: "guest_hallucination_audit_last_run", config_value: report.run_at },
      { config_key: "guest_hallucination_audit_summary", config_value: summary },
    ],
    { onConflict: "config_key" },
  );
}

/** Full weekly audit — load KB, run probes, persist. Called from whatsapp-cron. */
export async function runWeeklyGuestHallucinationAudit(
  supabase: SupabaseClient,
): Promise<HallucinationAuditReport> {
  const { data } = await supabase
    .from("bot_settings")
    .select("knowledge_base")
    .eq("id", 1)
    .maybeSingle();

  const kb = String((data as Record<string, unknown> | null)?.knowledge_base ?? "");
  const report = runHallucinationAuditProbes(kb);
  await persistHallucinationAuditReport(supabase, report);

  if (report.failed > 0) {
    console.warn(
      `[guestHallucinationAudit] ${report.failed}/${report.total} probes FAILED — ` +
      `failed: ${report.rows.filter((r) => !r.passed).map((r) => r.probe_id).join(", ")}`,
    );
  } else {
    console.info(`[guestHallucinationAudit] PASSED ${report.passed}/${report.total} probes`);
  }

  return report;
}

export { GUEST_STAFF_HANDOFF_SENTENCE };
