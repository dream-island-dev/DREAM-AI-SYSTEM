// Run: deno test --allow-env supabase/functions/_shared/oritAgentSigalChat.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { composeSigalAckSentMessage, composeSigalConfirmPrompt } from "./oritAgentSigalChat.ts";

Deno.test("composeSigalConfirmPrompt — full text before send", () => {
  const body = composeSigalConfirmPrompt(
    "confirm_ack",
    "נעמי",
    "naomi@example.com",
    "שלום נעמי,\nקיבלנו את פנייתך.\nניצור איתך קשר ב-72 שעות.",
    "869b0a98-781a-4f3a-954c-7c263232d7b5",
  );
  if (!body.includes("כן שלחי")) throw new Error("missing confirm CTA");
  assertEquals(body.includes("naomi@example.com"), true);
});

Deno.test("composeSigalAckSentMessage — view thread link", () => {
  const body = composeSigalAckSentMessage(
    "נעמי",
    "naomi@example.com",
    "שלום נעמי, קיבלנו את פנייתך.",
    "869b0a98-781a-4f3a-954c-7c263232d7b5",
  );
  if (!body.includes("נשלח")) throw new Error("missing sent");
  assertEquals(body.includes("thread=869b0a98"), true);
});
