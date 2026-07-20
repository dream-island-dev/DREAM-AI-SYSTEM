// Run: deno test --allow-env supabase/functions/_shared/oritAgentWorkflow.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeOritWorkflowAlert,
  composeSigalGuestReplyCoaching,
  isOritWorkflowComplaint,
  parseOritWorkflowAckApproval,
} from "./oritAgentWorkflow.ts";

Deno.test("isOritWorkflowComplaint — high/critical complaints", () => {
  assertEquals(isOritWorkflowComplaint("complaint", "high"), true);
  assertEquals(isOritWorkflowComplaint("complaint", "critical"), true);
  assertEquals(isOritWorkflowComplaint("complaint", "normal"), false);
  assertEquals(isOritWorkflowComplaint("lead", "high"), false);
});

Deno.test("parseOritWorkflowAckApproval", () => {
  assertEquals(parseOritWorkflowAckApproval("אשרי"), true);
  assertEquals(parseOritWorkflowAckApproval("1"), true);
  assertEquals(parseOritWorkflowAckApproval("לא"), false);
});

Deno.test("composeOritWorkflowAlert — pulse steps, no inline drafts", () => {
  const body = composeOritWorkflowAlert({
    id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
    subject: "תלונה",
    from_name: "נעמי",
    from_email: "relay@richkid.co.il",
    guest_contact_email: "naomi@example.com",
    category: "complaint",
    urgency: "high",
    ai_summary: "אורחת מתלוננת על ניקיון החדר.",
  }, "שלום נעמי,\nקיבלנו את פנייתך.\nניצור איתך קשר ב-72 שעות.", "שלום נעמי,\nאנחנו מטפלים בניקיון.");

  if (!body.includes("ניקיון")) throw new Error("missing summary");
  if (!body.includes("שלב 1")) throw new Error("missing step 1");
  if (!body.includes("תראי לי")) throw new Error("missing ack CTA");
  if (body.includes("קיבלנו את פנייתך.\n")) throw new Error("should not inline ack draft");
  if (!body.includes("תראי לי")) throw new Error("missing ack CTA");
  assertEquals(body.includes("תסדרי"), true);
});

Deno.test("composeSigalGuestReplyCoaching — snippet only", () => {
  const body = composeSigalGuestReplyCoaching(
    {
      id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
      subject: "תלונה",
      from_name: "נעמי",
      guest_contact_name: null,
    },
    "תודה, אבל עדיין לא קיבלתי החזר.",
    "שלום נעמי,\nאני בודקת את הנושא מול הנהלה.",
  );

  if (!body.includes("לא קיבלתי החזר")) throw new Error("missing guest snippet");
  if (body.includes("בודקת את הנושא")) throw new Error("should not inline draft");
  if (!body.includes("תשובה מלאה")) throw new Error("missing CTA");
});
