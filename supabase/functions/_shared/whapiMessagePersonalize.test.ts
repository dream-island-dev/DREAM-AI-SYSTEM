// supabase/functions/_shared/whapiMessagePersonalize.test.ts
// Run: deno test --no-check --allow-env supabase/functions/_shared/whapiMessagePersonalize.test.ts

import { assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  appendWhapiUniqueRef,
  generateWhapiShortRef,
  hasWhapiNamePlaceholder,
  personalizeWhapiBody,
  substituteWhapiName,
} from "./whapiMessagePersonalize.ts";

Deno.test("hasWhapiNamePlaceholder: detects {{שם}} and {{name}}, case/spacing tolerant", () => {
  assertEquals(hasWhapiNamePlaceholder("היי {{שם}}!"), true);
  assertEquals(hasWhapiNamePlaceholder("Hi {{ name }}"), true);
  assertEquals(hasWhapiNamePlaceholder("Hi {{ NAME }}"), true);
  assertEquals(hasWhapiNamePlaceholder("שלום, מה שלומך?"), false);
});

Deno.test("substituteWhapiName: named contact gets the token replaced", () => {
  assertEquals(substituteWhapiName("היי {{שם}}! מה שלומך?", "דנה"), "היי דנה! מה שלומך?");
});

Deno.test("substituteWhapiName: unnamed contact drops the greeting token, not a blank", () => {
  assertEquals(substituteWhapiName("היי {{שם}}! מה שלומך?", ""), "היי! מה שלומך?");
  assertEquals(substituteWhapiName("היי {{שם}}! מה שלומך?", null), "היי! מה שלומך?");
});

Deno.test("appendWhapiUniqueRef: appends a 4-char ref with the separator", () => {
  const out = appendWhapiUniqueRef("שלום", "A7F2");
  assertEquals(out, "שלום\n· #A7F2");
});

Deno.test("generateWhapiShortRef: 4 characters, avoids ambiguous glyphs", () => {
  const ref = generateWhapiShortRef();
  assertEquals(ref.length, 4);
  assertMatch(ref, /^[A-HJ-NP-Z2-9]{4}$/);
});

Deno.test("personalizeWhapiBody: two calls for the same unnamed template produce different bodies when appendUniqueRef=true", () => {
  const a = personalizeWhapiBody("היי {{שם}}! בואו למלא סקר", { name: "", appendUniqueRef: true });
  const b = personalizeWhapiBody("היי {{שם}}! בואו למלא סקר", { name: "", appendUniqueRef: true });
  assertNotEquals(a, b);
});

Deno.test("personalizeWhapiBody: no suffix added when appendUniqueRef is false/omitted", () => {
  const out = personalizeWhapiBody("היי {{שם}}!", { name: "דנה" });
  assertEquals(out, "היי דנה!");
});

Deno.test("personalizeWhapiBody: explicit uniqueRef is deterministic (useful in tests/replays)", () => {
  const out = personalizeWhapiBody("היי {{שם}}!", { name: "דנה", appendUniqueRef: true, uniqueRef: "ZZZZ" });
  assertEquals(out, "היי דנה!\n· #ZZZZ");
});
