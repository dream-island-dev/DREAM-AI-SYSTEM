// Shared Orit thread analysis (sync + manual) — tier0 for leads, LLM for complaints.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeOritThread } from "./oritAgentAi.ts";
import {
  bodyHasComplaintSignal,
  classifyOritThreadTier0,
  pickStyleSamplesForCategory,
  shouldAnalyzeOritWithLlm,
  tier0ToAnalysisResult,
} from "./oritAgentAnalyzePolicy.ts";
import { isGenericLeadFormSubject } from "./oritAgentClassify.ts";
import { isOritWorkflowComplaint } from "./oritAgentWorkflow.ts";

export type OritThreadAnalysisRow = {
  id: string;
  subject: string;
  from_name: string | null;
  from_email: string;
  snippet: string | null;
  category?: string | null;
  auto_ack_sent_at?: string | null;
  workflow_step?: string | null;
};

function buildFallbackAckSuggestion(guestName: string): string {
  const name = guestName?.trim() && !guestName.includes("@") ? guestName : "שלום רב";
  return [
    `${name},`,
    "",
    "תודה שפניתם אלינו ושיתפתם אותנו בחווייתכם.",
    "קיבלנו את פנייתך ואנו מתייחסים לכך ברצינות רבה.",
    "אבחן את הנושא ואיצור עמך קשר טלפוני בתוך 72 השעות הקרובות.",
    "",
    "בברכה,",
    "אורית חלפון",
    "מנהלת שירות לאורח",
    "דרים איילנד — אתר הנופש",
  ].join("\n");
}

/** Strip third-person self-references — illogical when the mail is signed as Orit. */
export function sanitizeOritAckDraft(text: string): string {
  const lines = (text || "").split(/\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/מנהלת\s+שירות\s+לאורח.*אורית\s+חלפון.*(תבחן|תיצור|תצור|תחזור)/i.test(t)) return false;
    if (/אורית\s+חלפון.*(תבחן|תיצור|תצור|תחזור|תיצמד)/i.test(t)) return false;
    if (/^מנהלת\s+שירות\s+לאורח,\s*אורית\s+חלפון,/i.test(t)) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchOritThreadInbound(
  supabase: SupabaseClient,
  threadId: string,
): Promise<string> {
  const { data: msgs } = await supabase
    .from("orit_agent_messages")
    .select("body_text, direction")
    .eq("thread_id", threadId)
    .order("received_at", { ascending: true });

  return (msgs ?? []).filter((m) => m.direction === "inbound").map((m) => m.body_text).join("\n");
}

export async function runOritThreadAnalysis(
  supabase: SupabaseClient,
  mailboxId: string,
  thread: OritThreadAnalysisRow,
  opts: { forceLlm?: boolean } = {},
): Promise<ReturnType<typeof analyzeOritThread>> {
  const inbound = await fetchOritThreadInbound(supabase, thread.id);
  const bodyText = inbound || thread.snippet || "";

  const tier0 = classifyOritThreadTier0(bodyText, thread.subject);
  const categoryHint = tier0?.category
    ?? (bodyHasComplaintSignal(bodyText) ? "complaint" : (thread.category || "other"));

  const { data: samples } = await supabase
    .from("orit_agent_style_samples")
    .select("inbound_snippet, outbound_text, context_category")
    .eq("mailbox_id", mailboxId)
    .order("created_at", { ascending: false })
    .limit(24);

  const styleSamples = pickStyleSamplesForCategory(samples ?? [], categoryHint);

  const forceLlm = opts.forceLlm === true
    || thread.category === "complaint"
    || bodyHasComplaintSignal(bodyText);

  if (!shouldAnalyzeOritWithLlm(bodyText, thread.subject, tier0, { forceLlm })) {
    if (tier0) return tier0ToAnalysisResult(tier0);
    return {
      urgency: "normal",
      urgency_reason: "פניית ליד / שגרתית — ללא ניתוח AI (חיסכון בקרדיטים).",
      category: isGenericLeadFormSubject(thread.subject) ? "lead" : "other",
      summary: bodyText.slice(0, 280) || thread.subject || "פניית אורח.",
      suggestions: [],
      engine: "tier0-no-llm",
    };
  }

  return analyzeOritThread({
    subject: thread.subject,
    fromName: thread.from_name,
    fromEmail: thread.from_email,
    bodyText,
    styleSamples,
    draftCategory: categoryHint,
  }, { forceLlm: true });
}

export async function persistOritThreadAnalysis(
  supabase: SupabaseClient,
  threadId: string,
  analysis: Awaited<ReturnType<typeof analyzeOritThread>>,
  createdBy?: string,
  threadMeta?: Pick<OritThreadAnalysisRow, "from_name" | "auto_ack_sent_at" | "workflow_step">,
): Promise<void> {
  const workflowComplaint = isOritWorkflowComplaint(analysis.category, analysis.urgency);
  const ackAlreadySent = Boolean(threadMeta?.auto_ack_sent_at);

  const threadUpdate: Record<string, unknown> = {
    urgency: analysis.urgency,
    urgency_reason: analysis.urgency_reason,
    category: analysis.category,
    ai_summary: analysis.summary,
    ai_analyzed_at: new Date().toISOString(),
  };

  if (workflowComplaint && !ackAlreadySent) {
    threadUpdate.workflow_step = "awaiting_ack_approval";
  } else if (ackAlreadySent) {
    threadUpdate.workflow_step = "awaiting_reply_approval";
    threadUpdate.status = "awaiting_reply";
  }

  await supabase.from("orit_agent_threads").update(threadUpdate).eq("id", threadId);

  if (!ackAlreadySent) {
    await supabase.from("orit_agent_drafts").delete()
      .eq("thread_id", threadId)
      .eq("draft_kind", "ack")
      .in("status", ["suggested", "edited"]);

    const ackText = sanitizeOritAckDraft(
      analysis.ackSuggestion || buildFallbackAckSuggestion(threadMeta?.from_name || ""),
    );
    await supabase.from("orit_agent_drafts").insert({
      thread_id: threadId,
      suggested_text: ackText,
      draft_kind: "ack",
      status: "suggested",
      ...(createdBy ? { created_by: createdBy } : {}),
    });
  }

  await supabase.from("orit_agent_drafts").delete()
    .eq("thread_id", threadId)
    .eq("draft_kind", "full_reply")
    .in("status", ["suggested", "edited"]);

  if (analysis.suggestions.length) {
    await supabase.from("orit_agent_drafts").insert(
      analysis.suggestions.map((text) => ({
        thread_id: threadId,
        suggested_text: text,
        draft_kind: "full_reply",
        status: "suggested",
        ...(createdBy ? { created_by: createdBy } : {}),
      })),
    );
  }
}
