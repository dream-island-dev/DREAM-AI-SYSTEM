// Run: deno test --allow-env supabase/functions/_shared/oritSigalGuide.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveOritSigalIntent } from "./oritSigalGuide.ts";

Deno.test("resolveOritSigalIntent — typed commands", () => {
  assertEquals(resolveOritSigalIntent("תראי לי"), "show_ack");
  assertEquals(resolveOritSigalIntent("אשרי"), "prepare_ack");
  assertEquals(resolveOritSigalIntent("כן שלחי"), "confirm_send");
  assertEquals(resolveOritSigalIntent("מה כתבה"), "show_guest");
  assertEquals(resolveOritSigalIntent("סיימתי"), "mark_done");
});

Deno.test("resolveOritSigalIntent — voice-style phrases", () => {
  assertEquals(resolveOritSigalIntent("בבקשה תראי לי את המייל"), "show_ack");
  assertEquals(resolveOritSigalIntent("בסדר תשלחי"), "confirm_send");
  assertEquals(resolveOritSigalIntent("מה היא כתבה לנו"), "show_guest");
  assertEquals(resolveOritSigalIntent("איך אני מתקדמת"), "help");
  assertEquals(resolveOritSigalIntent("תשלחי לי את התשובה המלאה"), "show_full");
});
