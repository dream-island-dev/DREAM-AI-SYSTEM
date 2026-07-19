// Run: deno test --allow-env supabase/functions/_shared/oritSigalUiNotify.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { composeSigalUiSendConfirmation } from "./oritSigalUiNotify.ts";

const THREAD = {
  id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
  subject: "תלונה",
  from_name: "נעמי",
  from_email: "naomi@example.com",
  category: "complaint",
  urgency: "high",
  ai_summary: "תלונה על ניקיון",
};

Deno.test("composeSigalUiSendConfirmation — ack email includes app link", () => {
  const body = composeSigalUiSendConfirmation(THREAD, "ack", "email");
  if (!body.includes("שלחת מהממשק")) throw new Error("missing ui send label");
  assertEquals(body.includes("orit_cs_agent"), true);
  assertEquals(body.includes("thread="), true);
});

Deno.test("composeSigalUiSendConfirmation — full reply whatsapp", () => {
  const body = composeSigalUiSendConfirmation(THREAD, "full_reply", "whatsapp_bridge");
  if (!body.includes("המכתב המלא")) throw new Error("missing full reply label");
  assertEquals(body.includes("בוואטסאפ"), true);
});
