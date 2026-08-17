// deno test supabase/functions/_shared/opsNoAnswer.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  extractWhapiQuotedRef,
  isOpsNoAnswerText,
  parseOpsNoAnswerRoomIds,
  parseSuiteLabelFromTaskCard,
  roomIdFromSuiteLabel,
} from "./opsNoAnswer.ts";

Deno.test("isOpsNoAnswerText — English and Hebrew", () => {
  assertEquals(isOpsNoAnswerText("5 no answer"), true);
  assertEquals(isOpsNoAnswerText("no_answer"), true);
  assertEquals(isOpsNoAnswerText("אין מענה"), true);
  assertEquals(isOpsNoAnswerText("5- מגבות"), false);
});

Deno.test("parseOpsNoAnswerRoomIds — 5 no answer", () => {
  assertEquals(parseOpsNoAnswerRoomIds("5 no answer"), ["5"]);
  assertEquals(parseOpsNoAnswerRoomIds("no answer 12"), ["12"]);
  assertEquals(parseOpsNoAnswerRoomIds("4,5 אין מענה"), ["4", "5"]);
});

Deno.test("parseSuiteLabelFromTaskCard", () => {
  const card = "📌 Suite ג׳ספר 5\n[GUEST WA]\nDENTAL KIT\n👍🏼 done";
  assertEquals(parseSuiteLabelFromTaskCard(card), "ג׳ספר 5");
});

Deno.test("roomIdFromSuiteLabel", () => {
  assertEquals(roomIdFromSuiteLabel("ג׳ספר 5"), "5");
  assertEquals(roomIdFromSuiteLabel("אמטיסט 10"), "10");
});

Deno.test("extractWhapiQuotedRef — quoted_message + quoted_id", () => {
  const ref = extractWhapiQuotedRef({
    quoted_id: "wamid-card",
    quoted_message: { id: "wamid-card", text: { body: "📌 Suite ג׳ספר 5\nDENTAL KIT" } },
  });
  assertEquals(ref.id, "wamid-card");
  assertEquals(parseSuiteLabelFromTaskCard(ref.text), "ג׳ספר 5");
});
