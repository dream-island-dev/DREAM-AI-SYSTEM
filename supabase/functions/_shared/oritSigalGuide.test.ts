// Run: deno test --allow-env supabase/functions/_shared/oritSigalGuide.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  resolveOritSigalIntent,
  isOritRefineInstruction,
  isLikelyCustomDraft,
} from "./oritSigalGuide.ts";

Deno.test("resolveOritSigalIntent — typed commands", () => {
  assertEquals(resolveOritSigalIntent("תראי לי"), "show_ack");
  assertEquals(resolveOritSigalIntent("אשרי"), "prepare_ack");
  assertEquals(resolveOritSigalIntent("כן שלחי"), "confirm_send");
  assertEquals(resolveOritSigalIntent("מה כתבה"), "show_guest");
  assertEquals(resolveOritSigalIntent("סיימתי"), "mark_done");
  assertEquals(resolveOritSigalIntent("טיפלתי בזה"), "mark_done");
  assertEquals(resolveOritSigalIntent("סמן כטופל"), "mark_done");
  assertEquals(resolveOritSigalIntent("שלחי בוואטסאפ"), "send_whatsapp");
  assertEquals(resolveOritSigalIntent("קיבלנו את פנייתך"), "show_ack");
  assertEquals(resolveOritSigalIntent("שלב 1"), "show_ack");
});

Deno.test("resolveOritSigalIntent — voice-style phrases", () => {
  assertEquals(resolveOritSigalIntent("בבקשה תראי לי את המייל"), "show_ack");
  assertEquals(resolveOritSigalIntent("בסדר תשלחי"), "confirm_send");
  assertEquals(resolveOritSigalIntent("מה היא כתבה לנו"), "show_guest");
  assertEquals(resolveOritSigalIntent("איך אני מתקדמת"), "help");
  assertEquals(resolveOritSigalIntent("תשלחי לי את התשובה המלאה"), "show_full");
});

Deno.test("resolveOritSigalIntent — schedule commands", () => {
  assertEquals(resolveOritSigalIntent("תזמני למחר 8"), "schedule_send");
  assertEquals(resolveOritSigalIntent("מה מתוזמן"), "show_schedule");
  assertEquals(resolveOritSigalIntent("בטלי תזמון"), "cancel_schedule");
  assertEquals(resolveOritSigalIntent("כן תזמני"), "confirm_schedule");
});
  assertEquals(resolveOritSigalIntent("מה את עושה בשבילי"), "intro");
  assertEquals(resolveOritSigalIntent("איך את עוזרת לי"), "intro");
});

Deno.test("isOritRefineInstruction — verbal edit vs full paste", () => {
  assertEquals(isOritRefineInstruction("תסדרי את הטקסט תכתבי יותר אישי"), true);
  assertEquals(isOritRefineInstruction("תוסיפי התנצלות על העיכוב"), true);
  assertEquals(isOritRefineInstruction("כן שלחי"), false);
  assertEquals(isOritRefineInstruction("תראי לי"), false);
  const full = "שלום רב,\nתודה שפניתם אלינו.\nקיבלנו את פנייתך ואנו מתייחסים לכך ברצינות.\nבברכה,\nאורית חלפון";
  assertEquals(isLikelyCustomDraft(full), true);
  assertEquals(isOritRefineInstruction(full), false);
});
