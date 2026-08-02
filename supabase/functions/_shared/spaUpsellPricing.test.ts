// Run: deno test --allow-env supabase/functions/_shared/spaUpsellPricing.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildSpaUpsellAcceptForwardLine,
  formatSpaUpsellOfferLabel,
  parseSpaUpsellPricingFromScript,
  SPA_UPSELL_DEFAULT_OFFER_PRICE,
} from "./spaUpsellPricing.ts";

Deno.test("parseSpaUpsellPricingFromScript: 280/380 live offer", () => {
  const text =
    "היי {{GUEST_NAME}} 🍹 לקראת הגעתכם לריזורט, טיפול 45 דק' במחיר מיוחד - 280 ₪ לאדם (מחיר מלא 380 ₪).";
  const p = parseSpaUpsellPricingFromScript(text);
  assertEquals(p.offerPrice, 280);
  assertEquals(p.fullPrice, 380);
  assertEquals(p.durationMin, 45);
});

Deno.test("parseSpaUpsellPricingFromScript: legacy 300/370", () => {
  const text =
    "מוסיפים עיסוי מרגיע של 45 דק׳ ב-300 ₪ בלבד (מחיר מלא 370 ₪).";
  const p = parseSpaUpsellPricingFromScript(text);
  assertEquals(p.offerPrice, 300);
  assertEquals(p.fullPrice, 370);
});

Deno.test("parseSpaUpsellPricingFromScript: empty → defaults", () => {
  const p = parseSpaUpsellPricingFromScript("");
  assertEquals(p.offerPrice, SPA_UPSELL_DEFAULT_OFFER_PRICE);
});

Deno.test("formatSpaUpsellOfferLabel + forward line", () => {
  const label = formatSpaUpsellOfferLabel({
    offerPrice: 280,
    fullPrice: 380,
    durationMin: 45,
  });
  assertEquals(label, "280₪/45 דק׳");
  assertEquals(
    buildSpaUpsellAcceptForwardLine(label),
    "מעוניין/ת בטיפול ספא (280₪/45 דק׳) — לתאם שעה",
  );
});
