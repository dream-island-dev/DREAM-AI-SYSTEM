// Run: deno test --allow-env supabase/functions/_shared/oritSigalLoop.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeSigalLoopNudge,
  resolveSigalLoopPhase,
  sigalLoopTiming,
} from "./oritSigalBriefing.ts";

const baseThread = {
  id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
  subject: "תלונה",
  from_name: "מיקי",
  from_email: "guest@example.com",
  category: "complaint",
  urgency: "high",
  ai_summary: "תלונה על ניקיון",
  received_at: new Date(Date.now() - 7 * 3_600_000).toISOString(),
};

Deno.test("resolveSigalLoopPhase — workflow stages", () => {
  assertEquals(resolveSigalLoopPhase({ ...baseThread, workflow_step: "guest_replied" }), "guest_replied");
  assertEquals(resolveSigalLoopPhase({ ...baseThread, full_reply_sent_at: "2026-01-01" }), "awaiting_close");
  assertEquals(resolveSigalLoopPhase({ ...baseThread, auto_ack_sent_at: "2026-01-01" }), "awaiting_full_reply");
  assertEquals(resolveSigalLoopPhase(baseThread), "awaiting_ack");
});

Deno.test("sigalLoopTiming — critical is faster", () => {
  const critical = sigalLoopTiming("critical");
  const normal = sigalLoopTiming("normal");
  assertEquals(critical.staleHours < normal.staleHours, true);
  assertEquals(critical.cooldownHours <= normal.cooldownHours, true);
});

Deno.test("composeSigalLoopNudge — guest replied CTA + app link", () => {
  const body = composeSigalLoopNudge(
    { ...baseThread, workflow_step: "guest_replied" },
    "guest_replied",
    2,
  );
  if (!body.includes("השיב")) throw new Error("missing guest reply nudge");
  if (!body.includes("תשובה מלאה")) throw new Error("missing CTA");
  assertEquals(body.includes("orit_cs_agent"), true);
  assertEquals(body.includes("thread="), true);
});
