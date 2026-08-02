// supabase/functions/_shared/guestAlertWhapiNotify.test.ts
// Run: deno test --allow-env supabase/functions/_shared/guestAlertWhapiNotify.test.ts

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildGuestAlertWhapiCard,
  buildSpaUpsellAcceptOwnerDm,
  buildStaffAppDeepLink,
  formatGuestPhoneForStaffWa,
  phoneDigitsForDeepLink,
  resolveSpaUpsellNotifyPhone,
} from "./guestAlertWhapiNotify.ts";
import { ARCHITECT_PHONE_DIGITS } from "./executiveIdentity.ts";

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

Deno.test("formatGuestPhoneForStaffWa: E.164 to local 0x", () => {
  assertEquals(formatGuestPhoneForStaffWa("+972509939988"), "0509939988");
});

Deno.test("buildSpaUpsellAcceptOwnerDm: forward block + inbox link", () => {
  const dm = buildSpaUpsellAcceptOwnerDm({
    guestName: "נירה או אוליאל",
    phone: "+972509939988",
    room: "בילוי יומי",
    arrivalDate: "2026-08-11",
    guestReply: "אשמח לתאם",
  });
  assertStringIncludes(dm, "💆 אישור הצעת ספא");
  assertStringIncludes(dm, "הגעה: 11.08.2026");
  assertStringIncludes(dm, "נירה או אוליאל · 0509939988");
  assertStringIncludes(dm, "«אשמח לתאם»");
  assertStringIncludes(dm, "── להעברה לצוות הספא ──");
  assertStringIncludes(dm, "מעוניין/ת בטיפול ספא (280₪/45 דק׳)");
  assertStringIncludes(dm, "💬 שיחה: https://dream-ai-system.vercel.app/?page=wa_inbox&phone=972509939988");
});

Deno.test("resolveSpaUpsellNotifyPhone: defaults to architect", () => {
  const prev = Deno.env.get("SPA_UPSELL_NOTIFY_PHONE");
  Deno.env.delete("SPA_UPSELL_NOTIFY_PHONE");
  try {
    assertEquals(resolveSpaUpsellNotifyPhone(), ARCHITECT_PHONE_DIGITS);
  } finally {
    if (prev === undefined) Deno.env.delete("SPA_UPSELL_NOTIFY_PHONE");
    else Deno.env.set("SPA_UPSELL_NOTIFY_PHONE", prev);
  }
});
