// supabase/functions/_shared/guestRag.ts
// Lightweight RAG for guest concierge — keyword retrieval + optional pgvector.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const RAG_LOW_CONFIDENCE_THRESHOLD = 0.12;
export const RAG_TOP_K = 4;

export type RagRetrievalResult = {
  chunks: string[];
  confidence: number;
  mode: "keyword" | "full_kb" | "empty";
};

const HEBREW_STOP = new Set([
  "של", "את", "על", "זה", "מה", "איך", "האם", "יש", "לי", "לנו", "אני", "אנחנו",
  "the", "is", "a", "an", "to", "in", "of", "and", "or",
]);

function stripHebrewPrefix(word: string): string {
  return word.replace(/^[בלהמכש]['']?/u, "");
}

/** Booking / facility query expansions — helps audit probes and guest FAQ matching. */
const QUERY_TOKEN_EXPANSIONS: Record<string, string[]> = {
  מזמינים: ["הזמנת", "הזמנה", "לזמון", "זימון"],
  בספא: ["ספא"],
  בבריכה: ["בריכה", "בריכ"],
  במסעדה: ["מסעדה", "מסעד"],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !HEBREW_STOP.has(w));
}

function tokenMatchesChunk(token: string, chunkTokens: Set<string>): boolean {
  if (chunkTokens.has(token)) return true;

  const stripped = stripHebrewPrefix(token);
  if (stripped !== token && chunkTokens.has(stripped)) return true;

  for (const ct of chunkTokens) {
    const ctStripped = stripHebrewPrefix(ct);
    if (
      (stripped.length >= 3 && ct.includes(stripped))
      || (ctStripped.length >= 3 && stripped.includes(ctStripped))
    ) {
      return true;
    }
  }

  const expansions = QUERY_TOKEN_EXPANSIONS[token];
  if (expansions?.some((alt) => chunkTokens.has(alt) || [...chunkTokens].some((ct) => ct.includes(alt)))) {
    return true;
  }

  return false;
}

/** Split knowledge_base into paragraph chunks for retrieval. */
export function chunkKnowledgeText(text: string): string[] {
  const byParagraph = text
    .split(/\n{2,}|(?=•\s)|(?=▸\s)/)
    .map((c) => c.trim())
    .filter((c) => c.length > 20);

  if (byParagraph.length > 1) return byParagraph;

  // Typical admin KB: one fact per line without blank lines — split for keyword hits.
  const byLine = text
    .split(/\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 20);

  if (byLine.length > 0) return byLine;

  const trimmed = text.trim();
  return trimmed.length > 20 ? [trimmed] : [];
}

function scoreChunk(queryTokens: string[], chunk: string): number {
  if (!queryTokens.length) return 0;
  const chunkTokens = new Set(tokenize(chunk));
  let hits = 0;
  for (const t of queryTokens) {
    if (tokenMatchesChunk(t, chunkTokens)) hits++;
  }
  return hits / queryTokens.length;
}

/**
 * Keyword-overlap retrieval — no embedding API required.
 * Falls back to full KB injection when query is empty.
 */
export function retrieveGuestKnowledge(
  knowledgeBase: string,
  userMessage: string,
  topK = RAG_TOP_K,
): RagRetrievalResult {
  const kb = (knowledgeBase ?? "").trim();
  if (!kb) return { chunks: [], confidence: 0, mode: "empty" };

  const query = (userMessage ?? "").trim();
  if (!query) {
    return { chunks: [kb], confidence: 1, mode: "full_kb" };
  }

  const chunks = chunkKnowledgeText(kb);
  if (!chunks.length) {
    return { chunks: [kb], confidence: 0.5, mode: "full_kb" };
  }

  const queryTokens = tokenize(query);
  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTokens, chunk) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score > 0).slice(0, topK);
  if (!top.length) {
    return { chunks: [], confidence: 0, mode: "keyword" };
  }

  const confidence = top[0].score;
  return {
    chunks: top.map((t) => t.chunk),
    confidence,
    mode: "keyword",
  };
}

export function formatRagContextBlock(chunks: string[]): string {
  if (!chunks.length) return "";
  return `\n\n══ ידע רלוונטי (RAG) ══\n${chunks.join("\n\n")}`;
}

/** True when guest likely asks a factual resort question (hours, location, price). */
export function looksLikeFactualResortQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  return /שעות?|מתי|איפה|כמה|מחיר|צ['']?ק|בריכ|ספא|מסעד|wi-?fi|wifi|חניה|כניסה/i.test(t);
}

/** Persist chunks for future pgvector upgrade (best-effort, non-blocking). */
export async function syncKnowledgeChunksToDb(
  supabase: SupabaseClient,
  knowledgeBase: string,
): Promise<void> {
  const kb = (knowledgeBase ?? "").trim();
  if (!kb) return;

  try {
    const chunks = chunkKnowledgeText(kb);
    if (!chunks.length) return;

    await supabase.from("guest_knowledge_chunks").delete().neq("id", 0);
    const rows = chunks.map((chunk_text, i) => ({
      chunk_text,
      source: "knowledge_base",
      chunk_index: i,
    }));
    const { error } = await supabase.from("guest_knowledge_chunks").insert(rows);
    if (error && !/does not exist|relation/i.test(error.message)) {
      console.warn("[guestRag] syncKnowledgeChunksToDb:", error.message);
    }
  } catch (e) {
    console.warn("[guestRag] syncKnowledgeChunksToDb failed:", (e as Error).message);
  }
}
