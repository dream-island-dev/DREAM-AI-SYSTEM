import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "./nofshonitNationalId.ts";

Deno.test("nofshonitNationalId — direct ת.ז. match", () => {
  const rows = [
    { מזהה: "203232623", CouponNo: "203554126", CouponDesc: "deluxe", "שם לקוח": "נטלי" },
    { מזהה: "203232623", CouponNo: "204232623", CouponDesc: "deluxe", "שם לקוח": "נטלי" },
  ];
  const idx = buildNofshonitEasygoIndex(rows);
  const direct = resolveNofshonitProviderToNationalId("203232623", idx.couponToNationalId, idx.byNationalId);
  assertEquals(direct.nationalId, "203232623");
  assertEquals(direct.resolvedFrom, "direct_tz");
});

Deno.test("nofshonitNationalId — CouponNo in provider column maps to ת.ז.", () => {
  const rows = [
    { מזהה: "203232623", CouponNo: "203554126", CouponDesc: "deluxe" },
  ];
  const idx = buildNofshonitEasygoIndex(rows);
  const viaCoupon = resolveNofshonitProviderToNationalId("203554126", idx.couponToNationalId, idx.byNationalId);
  assertEquals(viaCoupon.nationalId, "203232623");
  assertEquals(viaCoupon.resolvedFrom, "coupon_lookup");
});

Deno.test("nofshonitNationalId — same order, multiple people (different ת.ז.)", () => {
  const rows = [
    { מזהה: "111111111", CouponNo: "900001", CouponDesc: "classic", "מס. הזמנה": "272736" },
    { מזהה: "222222222", CouponNo: "900002", CouponDesc: "classic", "מס. הזמנה": "272736" },
    { מזהה: "333333333", CouponNo: "900003", CouponDesc: "deluxe", "מס. הזמנה": "272736" },
    { מזהה: "444444444", CouponNo: "900004", CouponDesc: "deluxe", "מס. הזמנה": "272736" },
  ];
  const idx = buildNofshonitEasygoIndex(rows);
  assertEquals(idx.byNationalId.size, 4);
  assertEquals(resolveNofshonitProviderToNationalId("900003", idx.couponToNationalId, idx.byNationalId).nationalId, "333333333");
  assertEquals(resolveNofshonitProviderToNationalId("444444444", idx.couponToNationalId, idx.byNationalId).nationalId, "444444444");
});
