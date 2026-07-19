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

Deno.test("composeOritWorkflowAlert — problem + ack draft", () => {
  const body = composeOritWorkflowAlert({
    id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
    subject: "תלונה",
    from_name: "נעמי",
    category: "complaint",
    urgency: "high",
    ai_summary: "אורחת מתלוננת על ניקיון החדר.",
  }, "שלום נעמי,\nקיבלנו את פנייתך.\nניצור איתך קשר ב-72 שעות.");

  if (!body.includes("שלב 1")) throw new Error("missing step 1");
  if (!body.includes("ניקיון")) throw new Error("missing summary");
  if (!body.includes("קיבלנו את פנייתך")) throw new Error("missing ack draft");
  if (!body.includes("אשרי")) throw new Error("missing approve CTA");
  assertEquals(body.includes("thread=869b0a98"), true);
});

Deno.test("composeSigalGuestReplyCoaching — guest message + follow-up draft", () => {
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

  if (!body.includes("השיב/ה למייל")) throw new Error("missing guest reply header");
  if (!body.includes("לא קיבלתי החזר")) throw new Error("missing guest text");
  if (!body.includes("בודקת את הנושא")) throw new Error("missing follow-up draft");
  if (!body.includes("סיימתי")) throw new Error("missing close CTA");
});
