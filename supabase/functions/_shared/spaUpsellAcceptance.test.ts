import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  formatManualSpaUpsellLeadMessage,
  guestHasNoSpaSlotOnArrival,
  isManualSpaUpsellLeadMessage,
  isSpaUpsellAcceptanceEligible,
} from "./spaUpsellAcceptance.ts";

const SPA_UPSELL_ACCEPT_PHRASE_PATTERN =
  /אשמח.{0,40}(שיחזר|תחזר|תאם|לתאם|להזמין|לטיפול|לעיסוי)|(?:שיחזרו|תחזרו).{0,25}(אלי|אליכם|בחזרה)|(?:רוצה|מעוניין|מעוניינת|מעוניינים).{0,30}(ספא|עיסוי|טיפול|מסאז)|(?:לתאם|תיאום).{0,25}(ספא|עיסוי|טיפול|מסאז)/iu;

function isSpaUpsellAcceptanceReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SPA_UPSELL_ACCEPT_PHRASE_PATTERN.test(t);
}

Deno.test("isSpaUpsellAcceptanceReply: אשמח לתאם", () => {
  assertEquals(isSpaUpsellAcceptanceReply("אשמח לתאם"), true);
  assertEquals(isSpaUpsellAcceptanceReply("אשמח לתאם טיפול ספא"), true);
});

Deno.test("isSpaUpsellAcceptanceEligible: flag + no spa", () => {
  const guest = {
    msg_spa_upsell_sent: true,
    arrival_date: "2026-08-11",
    spa_date: null,
    spa_time: null,
  };
  assertEquals(isSpaUpsellAcceptanceEligible(guest), true);
  assertEquals(isSpaUpsellAcceptanceEligible({ ...guest, msg_spa_upsell_sent: false }), false);
  assertEquals(isSpaUpsellAcceptanceEligible({ ...guest, spa_time: "14:00" }), false);
});

Deno.test("guestHasNoSpaSlotOnArrival", () => {
  assertEquals(guestHasNoSpaSlotOnArrival({
    arrival_date: "2026-08-11",
    spa_date: "2026-08-11",
    spa_time: "10:00",
  }), false);
});

Deno.test("manual lead message prefix", () => {
  const msg = formatManualSpaUpsellLeadMessage("אשמח לתאם");
  assertEquals(isManualSpaUpsellLeadMessage(msg), true);
  assertEquals(msg.includes("אשמח לתאם"), true);
});
