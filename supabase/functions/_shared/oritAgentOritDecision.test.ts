// Run: deno test --allow-env supabase/functions/_shared/oritAgentOritDecision.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  composeOritThreadDecisionPrompt,
  parseOritCsDecisionReply,
} from "./oritAgentOritDecision.ts";

Deno.test("parseOritCsDecisionReply — numeric and Hebrew", () => {
  assertEquals(parseOritCsDecisionReply("1"), "email_ack");
  assertEquals(parseOritCsDecisionReply("מייל"), "email_ack");
  assertEquals(parseOritCsDecisionReply("2"), "whatsapp");
  assertEquals(parseOritCsDecisionReply("וואטסאפ"), "whatsapp");
  assertEquals(parseOritCsDecisionReply("שלום"), null);
});

Deno.test("composeOritThreadDecisionPrompt — asks Orit to choose", () => {
  const body = composeOritThreadDecisionPrompt({
    id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
    subject: "תלונה",
    from_name: "ads9@richkid.co.il",
    from_email: "ads9@richkid.co.il",
    guest_contact_name: "הדר ומתן",
    guest_contact_phone: "+972527364422",
    guest_contact_email: "hadar@example.com",
    category: "complaint",
    urgency: "high",
    ai_summary: "תלונה על אוכל בארוחת ערב.",
  });
  if (!body.includes("איך תרצי לטפל")) throw new Error("missing choice prompt");
  if (!body.includes("hadar@example.com")) throw new Error("missing guest email");
  if (!body.includes("1")) throw new Error("missing option 1");
  if (!body.includes("2")) throw new Error("missing option 2");
  if (body.includes("ads9@richkid.co.il")) throw new Error("must not show relay as guest email");
});
