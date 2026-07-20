// Run: deno test --allow-env supabase/functions/_shared/oritAgentWhapiAlert.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeOritUrgentAlert,
  isOritThreadAlertWorthy,
} from "./oritAgentWhapiAlert.ts";

Deno.test("isOritThreadAlertWorthy — serious complaints only", () => {
  assertEquals(isOritThreadAlertWorthy("complaint", "critical"), true);
  assertEquals(isOritThreadAlertWorthy("complaint", "high"), true);
  assertEquals(isOritThreadAlertWorthy("complaint", "normal"), false);
  assertEquals(isOritThreadAlertWorthy("lead", "normal"), false);
  assertEquals(isOritThreadAlertWorthy("booking", "critical"), false);
});

Deno.test("composeOritUrgentAlert — warm Sigal intro + CTA", () => {
  const body = composeOritUrgentAlert({
    id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
    subject: "ביטול הזמנה",
    from_name: "neomih@gmail.com",
    guest_contact_name: "נעמי",
    guest_contact_phone: "+972546206621",
    category: "booking",
    urgency: "high",
    auto_ack_sent_at: "2026-07-19T08:00:00Z",
    ai_summary: "נעמי מבקשת לבטל הזמנה למחר. יש לאמת שהביטול בוצע.",
  });
  if (!body.includes("היי אורית")) throw new Error("missing greeting");
  if (!body.includes("נעמי")) throw new Error("missing guest");
  if (!body.includes("054-620-6621")) throw new Error("missing phone");
  if (!body.includes("תראי לי")) throw new Error("missing CTA");
  if (!body.includes("ביטול")) throw new Error("missing summary");
  assertEquals(body.includes("orit_cs_agent"), true);
  assertEquals(body.includes("thread="), true);
});
