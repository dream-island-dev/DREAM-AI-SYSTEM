// When to spend LLM credits on Orit CS mail analysis (sync + auto paths).

import {
  isGenericLeadFormSubject,
  tier0ClassifyOritThread,
  type Tier0OritHint,
} from "./oritAgentClassify.ts";

const COMPLAINT_BODY_RE = /תלונ|אכזב|פיצוי|לא מרוצ|גרוע|נורא|מזעזע|החמיר|כישלון|נפגע|זועם|בושה|מחאה|החזר כספ|refund|complaint|disappoint/i;

export function bodyHasComplaintSignal(text: string): boolean {
  return COMPLAINT_BODY_RE.test((text || "").trim());
}

/** Tier-0 / keyword only — no Gemini/Claude (leads, routine inquiries). */
export function shouldAnalyzeOritWithLlm(
  bodyText: string,
  subject: string,
  tier0: Tier0OritHint | null,
  opts: { forceLlm?: boolean } = {},
): boolean {
  if (opts.forceLlm) return true;

  const body = (bodyText || "").trim();
  if (bodyHasComplaintSignal(body)) return true;
  if (tier0?.category === "complaint") return true;

  if (tier0?.category === "lead") return false;
  if (isGenericLeadFormSubject(subject) && !bodyHasComplaintSignal(body)) return false;

  if (tier0 && ["spa", "vendor", "internal", "other"].includes(tier0.category)) {
    return tier0.urgency === "critical" || tier0.urgency === "high";
  }

  if (tier0?.category === "booking") {
    return tier0.urgency === "critical" || tier0.urgency === "high";
  }

  return false;
}

export function tier0ToAnalysisResult(tier0: Tier0OritHint): {
  urgency: Tier0OritHint["urgency"];
  urgency_reason: string;
  category: Tier0OritHint["category"];
  summary: string;
  suggestions: string[];
  engine: string;
} {
  return {
    urgency: tier0.urgency,
    urgency_reason: tier0.urgency_reason,
    category: tier0.category,
    summary: tier0.summary,
    suggestions: tier0.suggestions,
    engine: tier0.engine === "tier0" ? "tier0-no-llm" : tier0.engine,
  };
}

export function classifyOritThreadTier0(bodyText: string, subject: string): Tier0OritHint | null {
  return tier0ClassifyOritThread(bodyText, subject);
}

export type OritStyleSampleRow = {
  inbound_snippet: string;
  outbound_text: string;
  context_category: string;
};

export function pickStyleSamplesForCategory(
  samples: OritStyleSampleRow[],
  category: string,
): OritStyleSampleRow[] {
  if (!samples.length) return [];
  if (category === "complaint") {
    const complaint = samples.filter((s) => s.context_category === "complaint");
    const rest = samples.filter((s) => s.context_category !== "complaint");
    return [...complaint, ...rest].slice(0, 8);
  }
  return samples.slice(0, 8);
}
