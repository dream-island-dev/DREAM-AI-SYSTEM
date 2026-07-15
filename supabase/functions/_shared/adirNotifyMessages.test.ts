// Run: deno test --allow-env supabase/functions/_shared/adirNotifyMessages.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildGuestAlertSlaEscalationText,
  buildPreCheckinGuestRequestAdirText,
  buildPortalOrderAdirText,
  handoffTypeLabelHe,
} from "./adirNotifyMessages.ts";

Deno.test("buildGuestAlertSlaEscalationText — Hebrew labels and action block", () => {
  const msg = buildGuestAlertSlaEscalationText({
    ageMinutes: 12,
    thresholdMinutes: 10,
    guestLabel: "כהן (אמטיסט 3)",
    alertType: "request",
    message: "מגבות נוספות",
    phone: "972501234567",
    guestName: "כהן",
  });
  assertEquals(msg.includes("בקשת אורח ממתינה"), true);
  assertEquals(msg.includes("🛎️ בקשת אורח"), true);
  assertEquals(msg.includes("מה לעשות"), true);
  assertEquals(msg.includes("wa_inbox"), true);
});

Deno.test("buildPreCheckinGuestRequestAdirText — future vs today", () => {
  const future = buildPreCheckinGuestRequestAdirText({
    room: "אמטיסט 5",
    guestName: "לוי",
    summary: "בלונים ליום הולדת",
    futureTag: "⚠️ בקשה עתידית — בעוד 3 ימים",
  });
  assertEquals(future.includes("לפני צ׳ק-אין"), true);
  assertEquals(future.includes("בעוד 3 ימים"), true);

  const today = buildPreCheckinGuestRequestAdirText({
    room: "אמטיסט 5",
    guestName: "לוי",
    summary: "כריות נוספות",
    arrivingToday: true,
  });
  assertEquals(today.includes("מגיעים היום"), true);
});

Deno.test("buildPortalOrderAdirText — Hebrew headline", () => {
  const msg = buildPortalOrderAdirText({
    guestName: "דנה",
    room: "Suite 2",
    itemLines: "  • יין אדום × 2",
    arrivalTag: "📅 הגעה בעוד 2 ימים",
  });
  assertEquals(msg.includes("הזמנה חדשה מהפורטל"), true);
  assertEquals(msg.includes("מה לעשות"), true);
});

Deno.test("handoffTypeLabelHe — known types", () => {
  assertEquals(handoffTypeLabelHe("date_change").includes("תאריך"), true);
  assertEquals(handoffTypeLabelHe("unknown_xyz").includes("פנייה"), true);
});
