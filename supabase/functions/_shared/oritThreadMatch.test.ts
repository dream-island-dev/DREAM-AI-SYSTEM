// Run: deno test --allow-env supabase/functions/_shared/oritThreadMatch.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  isRealGraphMessageId,
  normalizeOritSubject,
  subjectsLikelySame,
} from "./oritThreadMatch.ts";

Deno.test("normalizeOritSubject strips Re/Fwd", () => {
  assertEquals(normalizeOritSubject("Re: תלונה חמורה"), "תלונה חמורה");
  assertEquals(normalizeOritSubject("Fwd: Fwd: Contact form"), "contact form");
});

Deno.test("subjectsLikelySame", () => {
  assertEquals(subjectsLikelySame("תלונה", "Re: תלונה"), true);
  assertEquals(subjectsLikelySame("הזמנה", "תלונה"), false);
});

Deno.test("isRealGraphMessageId", () => {
  assertEquals(isRealGraphMessageId("AAMkAGI2…"), true);
  assertEquals(isRealGraphMessageId("sent-123"), false);
  assertEquals(isRealGraphMessageId("demo-ack"), false);
});
