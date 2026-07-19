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

export type OritThreadAnalysisRow = {
  id: string;
  subject: string;
  from_name: string | null;
  from_email: string;
  snippet: string | null;
  category?: string | null;
};

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
): Promise<void> {
  await supabase.from("orit_agent_threads").update({
    urgency: analysis.urgency,
    urgency_reason: analysis.urgency_reason,
    category: analysis.category,
    ai_summary: analysis.summary,
    ai_analyzed_at: new Date().toISOString(),
  }).eq("id", threadId);

  await supabase.from("orit_agent_drafts").delete().eq("thread_id", threadId).eq("status", "suggested");

  if (analysis.suggestions.length) {
    await supabase.from("orit_agent_drafts").insert(
      analysis.suggestions.map((text) => ({
        thread_id: threadId,
        suggested_text: text,
        status: "suggested",
        ...(createdBy ? { created_by: createdBy } : {}),
      })),
    );
  }
}
