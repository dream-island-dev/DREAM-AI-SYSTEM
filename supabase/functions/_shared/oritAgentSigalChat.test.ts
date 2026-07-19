// Run: deno test --allow-env supabase/functions/_shared/oritAgentSigalChat.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeOritWorkflowStatusLine,
  composeSigalAckSentMessage,
  composeSigalConfirmPrompt,
  threadNeedsAckBeforeFullReply,
} from "./oritAgentSigalChat.ts";

Deno.test("threadNeedsAckBeforeFullReply — complaint high needs ack", () => {
  assertEquals(
    threadNeedsAckBeforeFullReply({ category: "complaint", urgency: "high", auto_ack_sent_at: null }),
    true,
  );
  assertEquals(
    threadNeedsAckBeforeFullReply({ category: "complaint", urgency: "high", auto_ack_sent_at: "2026-01-01" }),
    false,
  );
  assertEquals(
    threadNeedsAckBeforeFullReply({ category: "lead", urgency: "normal", auto_ack_sent_at: null }),
    false,
  );
});

Deno.test("composeSigalConfirmPrompt — full text before send", () => {
  const body = composeSigalConfirmPrompt(
    "confirm_ack",
    "נעמי",
    "naomi@example.com",
    "שלום נעמי,\nקיבלנו את פנייתך.\nניצור איתך קשר ב-72 שעות.",
    "869b0a98-781a-4f3a-954c-7c263232d7b5",
  );
  if (!body.includes("הודעה ראשונה")) throw new Error("missing ack phase label");
  assertEquals(body.includes("קיבלנו את פנייתך"), true);
  assertEquals(body.includes("naomi@example.com"), true);
  assertEquals(body.includes("תסדרי"), true);
  assertEquals(body.includes("orit_cs_agent"), true);
  assertEquals(body.includes("thread="), true);
});

Deno.test("composeOritWorkflowStatusLine — includes mobile app link", () => {
  const body = composeOritWorkflowStatusLine({
    id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
    from_name: "נעמי",
    workflow_step: "awaiting_ack_approval",
    auto_ack_sent_at: null,
    full_reply_sent_at: null,
  });
  assertEquals(body.includes("orit_cs_agent"), true);
  assertEquals(body.includes("בממשק"), true);
  assertEquals(body.includes("שלב 1"), true);
  assertEquals(body.includes("במחשב"), false);
});

Deno.test("composeSigalAckSentMessage — ack follow-up", () => {
  const body = composeSigalAckSentMessage(
    "נעמי",
    "naomi@example.com",
    "שלום נעמי, קיבלנו את פנייתך.",
    "869b0a98-781a-4f3a-954c-7c263232d7b5",
  );
  if (!body.includes("קיבלנו את פנייתך")) throw new Error("missing ack phrase");
  if (!body.includes("שלב 2")) throw new Error("missing step 2 hint");
});
