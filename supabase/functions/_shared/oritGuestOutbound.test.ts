// Run: deno test --allow-env supabase/functions/_shared/oritGuestOutbound.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  adaptDraftForWhatsApp,
  formatGuestPhoneDisplay,
  normalizeOritGuestPhoneDigits,
  resolveOritOutboundChannel,
} from "./oritGuestOutbound.ts";
import { composeSigalComplaintBriefing } from "./oritSigalBriefing.ts";

Deno.test("resolveOritOutboundChannel — email first", () => {
  assertEquals(
    resolveOritOutboundChannel({
      id: "x",
      from_email: "relay@x.com",
      guest_contact_email: "guest@example.com",
      guest_contact_phone: "+972501234567",
    }),
    "email",
  );
  assertEquals(
    resolveOritOutboundChannel({
      id: "x",
      from_email: "relay@x.com",
      guest_contact_email: null,
      guest_contact_phone: "+972501234567",
    }),
    "whatsapp_bridge",
  );
  assertEquals(
    resolveOritOutboundChannel({
      id: "x",
      from_email: "relay@x.com",
      guest_contact_email: null,
      guest_contact_phone: null,
    }),
    "blocked",
  );
});

Deno.test("formatGuestPhoneDisplay", () => {
  assertEquals(formatGuestPhoneDisplay("+972501234567"), "050-123-4567");
});

Deno.test("adaptDraftForWhatsApp — shortens signature", () => {
  const out = adaptDraftForWhatsApp("שלום\nתודה\n\nבברכה,\nאורית חלפון", { bridge: true });
  if (out.includes("אורית חלפון")) throw new Error("signature should be trimmed");
  if (!out.includes("מייל")) throw new Error("bridge should ask for email");
});

Deno.test("composeSigalComplaintBriefing — WA bridge copy", () => {
  const body = composeSigalComplaintBriefing(
    {
      id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
      subject: "תלונה",
      from_email: "relay@x.com",
      guest_contact_phone: "+972501234567",
      category: "complaint",
      urgency: "high",
      ai_summary: "בעיה בחדר",
    },
    "שלום, קיבלנו את פנייתך.",
    "מכתב מלא",
  );
  if (!body.includes("אין כתובת מייל")) throw new Error("missing no-email note");
  if (!body.includes("שלחי בוואטסאפ")) throw new Error("missing WA CTA");
  if (body.includes("24")) throw new Error("no technical jargon");
});
