// supabase/functions/_shared/arrivalConfirmation.test.ts
//
// Run: deno test --allow-env supabase/functions/_shared/arrivalConfirmation.test.ts
//
// Covers the Stage 1 Whapi CTA safety net (ensureArrivalConfirmationCta) added
// 2026-07-12, plus a regression check that isArrivalConfirmationMessage still
// recognizes both the live bot_scripts.pre_arrival_2d seed phrase (migration
// 100) and the appended-CTA fallback text, and that the decline template
// never confirms.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isArrivalConfirmationMessage,
  ensureArrivalConfirmationCta,
  ARRIVAL_CONFIRM_CTA_HE,
} from "./arrivalConfirmation.ts";

const MIGRATION_100_SEED_BODY =
  'שלום {{GUEST_NAME}}! 🌴\n\nמחכים לכם ב-Dream Island בעוד יומיים.\nנשמח לאישור הגעה — כתבו לנו כאן "כן, מגיעים!" ונשלים את כל הפרטים יחד.\n\nנתראה בקרוב! 🤍';

Deno.test("ensureArrivalConfirmationCta: no-op when the live bot_scripts body already carries the CTA", () => {
  assertEquals(ensureArrivalConfirmationCta(MIGRATION_100_SEED_BODY), MIGRATION_100_SEED_BODY);
});

Deno.test("ensureArrivalConfirmationCta: appends canonical CTA when an edited body drops it", () => {
  const editedBody = "שלום דני! 🌴\n\nמחכים לך ב-Dream Island בעוד יומיים. נתראה בקרוב!";
  const result = ensureArrivalConfirmationCta(editedBody);
  assertStringIncludes(result, editedBody);
  assertStringIncludes(result, ARRIVAL_CONFIRM_CTA_HE);
});

Deno.test("ensureArrivalConfirmationCta: appended CTA is itself recognized by isArrivalConfirmationMessage's phrase", () => {
  const editedBody = "עדכון קצר לפני ההגעה שלכם.";
  const result = ensureArrivalConfirmationCta(editedBody);
  // The exact reply text the CTA asks the guest to type must round-trip
  // through the same confirmation detector the webhook uses.
  assertEquals(isArrivalConfirmationMessage('כן, מגיעים!'), true);
  assertStringIncludes(result, '"כן, מגיעים!"');
});

Deno.test("ensureArrivalConfirmationCta: does not double-append when only 'מגיעים' context already present", () => {
  const body = "אנחנו כבר סופרים ימים — אתם מגיעים בעוד יומיים ואנחנו מחכים! כן, נשמח לאשר יחד.";
  const result = ensureArrivalConfirmationCta(body);
  assertEquals(result, body);
});

Deno.test("regression: migration 100 seed CTA phrase still matches isArrivalConfirmationMessage", () => {
  assertEquals(isArrivalConfirmationMessage('כן, מגיעים!'), true);
});

Deno.test("regression: explicit date-change decline never confirms", () => {
  assertEquals(isArrivalConfirmationMessage("לא, שינוי בתאריך 🗓️"), false);
});

Deno.test("regression: bare 'לא' decline never confirms", () => {
  assertEquals(isArrivalConfirmationMessage("לא"), false);
});
