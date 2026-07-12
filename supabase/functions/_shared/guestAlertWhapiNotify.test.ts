// supabase/functions/_shared/guestAlertWhapiNotify.test.ts
// Run: deno test --allow-env supabase/functions/_shared/guestAlertWhapiNotify.test.ts

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildGuestAlertWhapiCard,
  buildStaffAppDeepLink,
  phoneDigitsForDeepLink,
} from "./guestAlertWhapiNotify.ts";

Deno.test("phoneDigitsForDeepLink strips + and non-digits", () => {
  assertEquals(phoneDigitsForDeepLink("+972501234567"), "972501234567");
  assertEquals(phoneDigitsForDeepLink(null), "");
});

Deno.test("buildStaffAppDeepLink matches frontend query shape", () => {
  assertEquals(
    buildStaffAppDeepLink({ page: "wa_inbox", phone: "+972501234567", guestName: "דני" }),
    "https://dream-ai-system.vercel.app/?page=wa_inbox&phone=972501234567&guestName=%D7%93%D7%A0%D7%99",
  );
  assertEquals(
    buildStaffAppDeepLink({ page: "requests_board" }),
    "https://dream-ai-system.vercel.app/?page=requests_board",
  );
});

Deno.test("buildGuestAlertWhapiCard: Hebrew headline + source + deep links", () => {
  const card = buildGuestAlertWhapiCard({
    alertType: "spa_request",
    message: "Guest Portal: Spa",
    guestName: "יהודה ורויטל חן",
    room: "אמלרד 19",
    sourceLabel: "Guest Portal",
    phone: "+972501234567",
  });
  assertStringIncludes(card, "💆 בקשת ספא — פורטל אורחים");
  assertStringIncludes(card, "אמלרד 19 (יהודה ורויטל חן)");
  assertStringIncludes(card, "Guest Portal: Spa");
  assertStringIncludes(card, "💬 שיחה: https://dream-ai-system.vercel.app/?page=wa_inbox&phone=972501234567");
  assertStringIncludes(card, "📋 לוח בקשות: https://dream-ai-system.vercel.app/?page=requests_board");
  assertEquals(card.includes("Please check"), false);
  assertEquals(card.includes("GUEST REQUEST"), false);
  assertEquals(card.includes("Suite "), false);
});

Deno.test("buildGuestAlertWhapiCard: no phone → omit chat link, keep board", () => {
  const card = buildGuestAlertWhapiCard({
    alertType: "request",
    message: "בקשת קפה",
    guestName: "אורח",
    room: "רויאל 1",
    sourceLabel: "Inbox",
  });
  assertStringIncludes(card, "🛎️ בקשת אורח — תיבה");
  assertEquals(card.includes("💬 שיחה:"), false);
  assertStringIncludes(card, "📋 לוח בקשות:");
});

Deno.test("buildGuestAlertWhapiCard: unknown alert_type is FAIL VISIBLE", () => {
  const card = buildGuestAlertWhapiCard({
    alertType: "weird_new_type",
    message: "x",
    phone: "972501111111",
  });
  assertStringIncludes(card, "⚠ weird_new_type");
});
