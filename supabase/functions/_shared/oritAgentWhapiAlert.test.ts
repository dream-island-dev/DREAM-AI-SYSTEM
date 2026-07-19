// Run: deno test --allow-env supabase/functions/_shared/oritAgentWhapiAlert.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeOritUrgentAlert,
  isOritThreadAlertWorthy,
} from "./oritAgentWhapiAlert.ts";

Deno.test("isOritThreadAlertWorthy — complaint always", () => {
  assertEquals(isOritThreadAlertWorthy("complaint", "normal"), true);
  assertEquals(isOritThreadAlertWorthy("lead", "normal"), false);
  assertEquals(isOritThreadAlertWorthy("booking", "critical"), true);
});

Deno.test("composeOritUrgentAlert includes deep link and summary", () => {
  const body = composeOritUrgentAlert({
    id: "1012cdc6-38c1-4151-8875-11a7f9b62a07",
    subject: "פניה מלידים",
    from_name: "guest@example.com",
    guest_contact_name: "הדר ומתן גואז",
    category: "complaint",
    urgency: "critical",
    ai_summary: "תלונה על אוכל בארוחת ערב",
  });
  if (!body.includes("סיגל")) throw new Error("missing sigal header");
  if (!body.includes("הדר ומתן גואז")) throw new Error("missing guest");
  if (!body.includes("thread=1012cdc6")) throw new Error("missing deep link");
  if (!body.includes("תלונה על אוכל")) throw new Error("missing summary");
});
