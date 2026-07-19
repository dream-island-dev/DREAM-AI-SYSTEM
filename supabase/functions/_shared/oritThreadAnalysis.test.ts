// Run: deno test --allow-env supabase/functions/_shared/oritThreadAnalysis.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { sanitizeOritAckDraft } from "./oritThreadAnalysis.ts";

const BAD_LINE = "מנהלת שירות לאורח, אורית חלפון, תבחן את הנושא ותיצור עמך קשר טלפוני בתוך 72 שעות לבירור מעמיק של פרטי התלונה.";

Deno.test("sanitizeOritAckDraft — removes third-person Orit contact line", () => {
  const input = [
    "שלום רב מיקי,",
    "",
    "תודה שפנית אלינו.",
    "קיבלנו את פנייתך בנוגע לתלונה.",
    BAD_LINE,
    "",
    "בברכה,",
    "אורית חלפון",
  ].join("\n");

  const out = sanitizeOritAckDraft(input);
  assertEquals(out.includes(BAD_LINE), false);
  assertEquals(out.includes("אורית חלפון"), true);
  assertEquals(out.includes("בברכה"), true);
});
