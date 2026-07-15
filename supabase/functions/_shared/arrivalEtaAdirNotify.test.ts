// supabase/functions/_shared/arrivalEtaAdirNotify.test.ts
// Run: deno test --allow-env supabase/functions/_shared/arrivalEtaAdirNotify.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildArrivalEtaAdirMessage,
  formatArrivalDateLabel,
  isArrivalEtaNotifyEligible,
  resolveAdirNotifyPhoneDigits,
  ADIR_PHONE_DIGITS,
} from "./arrivalEtaAdirNotify.ts";

const NOW = new Date("2026-07-15T10:00:00+03:00");

Deno.test("isArrivalEtaNotifyEligible — suite guest arriving today", () => {
  assertEquals(
    isArrivalEtaNotifyEligible(
      { arrival_date: "2026-07-15", room_type: "suite", room: "אמטיסט 3", status: "expected" },
      NOW,
    ),
    true,
  );
});

Deno.test("isArrivalEtaNotifyEligible — rejects day-pass", () => {
  assertEquals(
    isArrivalEtaNotifyEligible(
      { arrival_date: "2026-07-15", room: "Premium Day 1", status: "expected" },
      NOW,
    ),
    false,
  );
});

Deno.test("isArrivalEtaNotifyEligible — rejects arrival too far ahead", () => {
  assertEquals(
    isArrivalEtaNotifyEligible(
      { arrival_date: "2026-07-20", room_type: "suite", room: "אמטיסט 1", status: "expected" },
      NOW,
    ),
    false,
  );
});

Deno.test("buildArrivalEtaAdirMessage — tags Meta channel", () => {
  const msg = buildArrivalEtaAdirMessage({
    guestName: "כהן",
    room: "אמטיסט 3",
    arrivalDate: "2026-07-15",
    timeHhMm: "15:30",
    channel: "meta",
    phone: "+972501234567",
  });
  assertEquals(msg.includes("Dream Bot"), true);
  assertEquals(msg.includes("15:30"), true);
  assertEquals(msg.includes("שעת הגעה חדשה"), true);
  assertEquals(msg.includes("מה לעשות"), true);
});

Deno.test("buildArrivalEtaAdirMessage — update wording when time changed", () => {
  const msg = buildArrivalEtaAdirMessage({
    guestName: "כהן",
    room: "אמטיסט 3",
    arrivalDate: "2026-07-15",
    timeHhMm: "17:00",
    previousTime: "15:30",
    channel: "whapi",
    phone: "972501234567",
  });
  assertEquals(msg.includes("עודכה"), true);
  assertEquals(msg.includes("15:30 → 17:00"), true);
  assertEquals(msg.includes("מכשיר סוויטות"), true);
});

Deno.test("formatArrivalDateLabel — היום / מחר", () => {
  assertEquals(formatArrivalDateLabel("2026-07-15", NOW), "היום");
  assertEquals(formatArrivalDateLabel("2026-07-16", NOW), "מחר");
});

Deno.test("resolveAdirNotifyPhoneDigits — env override", () => {
  const prev = Deno.env.get("SLA_GUEST_ALERT_PHONE");
  Deno.env.set("SLA_GUEST_ALERT_PHONE", "0501234567");
  try {
    assertEquals(resolveAdirNotifyPhoneDigits(), "972501234567");
  } finally {
    if (prev === undefined) Deno.env.delete("SLA_GUEST_ALERT_PHONE");
    else Deno.env.set("SLA_GUEST_ALERT_PHONE", prev);
  }
});

Deno.test("resolveAdirNotifyPhoneDigits — default Adir", () => {
  const prev = Deno.env.get("SLA_GUEST_ALERT_PHONE");
  Deno.env.delete("SLA_GUEST_ALERT_PHONE");
  try {
    assertEquals(resolveAdirNotifyPhoneDigits(), ADIR_PHONE_DIGITS);
  } finally {
    if (prev === undefined) Deno.env.delete("SLA_GUEST_ALERT_PHONE");
    else Deno.env.set("SLA_GUEST_ALERT_PHONE", prev);
  }
});
