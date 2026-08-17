// deno test --allow-env supabase/functions/_shared/fieldOpsTranslation.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  applyFieldOpsKitTerms,
  looksTruncatedFieldOpsEnglish,
  stripInboxRoutePrefix,
  translateTextForFieldOps,
} from "./fieldOpsTranslation.ts";

Deno.test("stripInboxRoutePrefix — removes Inbox route label, keeps request", () => {
  assertEquals(
    stripInboxRoutePrefix("[מתיבת וואטסאפ — יעל כהן] 2 מברשות שיניים ומשחת שיניים"),
    "2 מברשות שיניים ומשחת שיניים",
  );
});

Deno.test("stripInboxRoutePrefix — hyphen variant", () => {
  assertEquals(
    stripInboxRoutePrefix("[מתיבת וואטסאפ - Guest] towels"),
    "towels",
  );
});

Deno.test("stripInboxRoutePrefix — no prefix unchanged", () => {
  assertEquals(stripInboxRoutePrefix("להביא מגבות"), "להביא מגבות");
});

Deno.test("looksTruncatedFieldOpsEnglish — dangling and", () => {
  assertEquals(looksTruncatedFieldOpsEnglish("Deliver 2 toothbrushes and"), true);
});

Deno.test("looksTruncatedFieldOpsEnglish — complete line", () => {
  assertEquals(looksTruncatedFieldOpsEnglish("Deliver 2 toothbrushes and toothpaste"), false);
});

Deno.test("applyFieldOpsKitTerms — toothbrushes + toothpaste → DENTAL KIT", () => {
  assertEquals(
    applyFieldOpsKitTerms("Deliver 2 toothbrushes and toothpaste"),
    "Deliver 2 x DENTAL KIT",
  );
});

Deno.test("applyFieldOpsKitTerms — ignores room number in Room-dash line", () => {
  assertEquals(
    applyFieldOpsKitTerms("Room ג׳ספר 5 - toothpaste"),
    "Room ג׳ספר 5 - DENTAL KIT",
  );
});

Deno.test("translateTextForFieldOps — dental-only Hebrew skips LLM", async () => {
  const line = await translateTextForFieldOps(
    "[מתיבת וואטסאפ — יעל] 🧴 שירותי נוחות — 2 מברשות שיניים ומשחת שיניים",
  );
  assertEquals(line, "2 x DENTAL KIT");
});
