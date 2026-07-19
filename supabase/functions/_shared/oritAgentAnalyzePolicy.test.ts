// Run: deno test --allow-env supabase/functions/_shared/oritAgentAnalyzePolicy.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  bodyHasComplaintSignal,
  shouldAnalyzeOritWithLlm,
} from "./oritAgentAnalyzePolicy.ts";
import { tier0ClassifyOritThread } from "./oritAgentClassify.ts";

Deno.test("shouldAnalyzeOritWithLlm — skips leads", () => {
  const body = "שלום, מעוניינת בפרטים על חבילת סוויטה לזוג";
  const tier0 = tier0ClassifyOritThread(body, "התקבלה פניה מלידים");
  assertEquals(shouldAnalyzeOritWithLlm(body, "התקבלה פניה מלידים", tier0), false);
});

Deno.test("shouldAnalyzeOritWithLlm — runs on complaints", () => {
  const body = "אני מאוכזבת מאוד מהשהות, התלונה שלי על האוכל והשירות";
  const tier0 = tier0ClassifyOritThread(body, "פנייה מהאתר");
  assertEquals(bodyHasComplaintSignal(body), true);
  assertEquals(shouldAnalyzeOritWithLlm(body, "פנייה", tier0), true);
});

Deno.test("shouldAnalyzeOritWithLlm — forceLlm overrides lead skip", () => {
  const body = "מעוניינת ביום כיף";
  const tier0 = tier0ClassifyOritThread(body, "ליד");
  assertEquals(shouldAnalyzeOritWithLlm(body, "ליד", tier0, { forceLlm: true }), true);
});
