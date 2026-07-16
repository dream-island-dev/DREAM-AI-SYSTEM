import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isGenericLeadFormSubject, tier0ClassifyOritThread } from "./oritAgentClassify.ts";

Deno.test("isGenericLeadFormSubject — website form subject", () => {
  assertEquals(isGenericLeadFormSubject("דרים איילנד - התקבלה פניה מלידים"), true);
  assertEquals(isGenericLeadFormSubject("שאלה על חבילה"), false);
});

Deno.test("tier0ClassifyOritThread — complaint despite lead subject", () => {
  const result = tier0ClassifyOritThread(
    "תלונה חמורה ובקשה לפיצוי בגין פגיעה קשה בחגיגת יום נישואין. האוכל הגיע קר.",
    "דרים איילנד - התקבלה פניה מלידים",
  );
  assertEquals(result?.category, "complaint");
  assertEquals(result?.urgency, "critical");
});

Deno.test("tier0ClassifyOritThread — genuine lead", () => {
  const result = tier0ClassifyOritThread(
    "שלום, מעוניינת לשמוע פרטים על סוויטה לזוג לסוף השבוע הקרוב.",
    "דרים איילנד - התקבלה פניה מלידים",
  );
  assertEquals(result?.category, "lead");
  assertEquals(result?.urgency, "normal");
});
