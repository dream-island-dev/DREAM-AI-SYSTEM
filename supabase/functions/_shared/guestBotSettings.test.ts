// supabase/functions/_shared/guestBotSettings.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveGuestBrainKnowledgeInjection } from "./guestBotSettings.ts";

const SAMPLE_KB = [
  "▸ צ'ק-אין לסוויטות: 15:00 בימי חול",
  "▸ בריכה: 08:00–20:00 כל יום",
  "▸ WiFi: DreamIsland_Guest — סיסמה בקבלה",
  "▸ ספא: הזמנה בטלפון 08-6705600",
].join("\n\n");

Deno.test("resolveGuestBrainKnowledgeInjection — factual miss → handoff, no full KB", () => {
  const r = resolveGuestBrainKnowledgeInjection(SAMPLE_KB, "יש לכם בר על הגג?");
  assertEquals(r.lowConfidenceHandoff, true);
  assertEquals(r.kbSuffix, "");
});

Deno.test("resolveGuestBrainKnowledgeInjection — factual hit → RAG chunks only", () => {
  const r = resolveGuestBrainKnowledgeInjection(SAMPLE_KB, "מתי הבריכה פתוחה?");
  assertEquals(r.lowConfidenceHandoff, false);
  assertEquals(r.kbSuffix.includes("בריכה"), true);
  assertEquals(r.kbSuffix.includes("צ'ק-אין"), false);
});

Deno.test("resolveGuestBrainKnowledgeInjection — chitchat miss → persona only, no full KB", () => {
  const r = resolveGuestBrainKnowledgeInjection(SAMPLE_KB, "תודה רבה!");
  assertEquals(r.lowConfidenceHandoff, false);
  assertEquals(r.kbSuffix, "");
});

Deno.test("resolveGuestBrainKnowledgeInjection — empty message → full KB", () => {
  const r = resolveGuestBrainKnowledgeInjection(SAMPLE_KB, "");
  assertEquals(r.lowConfidenceHandoff, false);
  assertEquals(r.kbSuffix.includes("בסיס ידע הריזורט"), true);
});
