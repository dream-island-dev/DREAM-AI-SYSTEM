import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  packageMatchGroup,
  packageTypesMatchEnhanced,
  buildVoucherQuantityAudit,
} from "./voucherQuantityAudit.ts";

Deno.test("packageTypesMatchEnhanced — Nofshonit night ↔ classic&dinner", () => {
  assertEquals(
    packageTypesMatchEnhanced(
      "Classic&more night יחיד (א-ד) מ 16:00- מבצע קיץ",
      "swish מבצע יולי 26 classic&dinner מ 16:00 א-ד",
    ),
    true,
  );
  assertEquals(packageMatchGroup("Classic&more night יחיד (א-ד) מ 16:00"), "classic_evening");
});

Deno.test("packageTypesMatchEnhanced — classic&more כל השבוע ↔ קלאסיק צהרים", () => {
  assertEquals(
    packageTypesMatchEnhanced(
      "classic&more - ליחיד (כל השבוע) 2026",
      "swish קלאסיק וארוחת צהרים 2026",
    ),
    true,
  );
});

Deno.test("buildVoucherQuantityAudit — counts per coupon", () => {
  const ez = [
    { voucher_number: "111", package_type: "swish קלאסיק", raw_extras: { CouponNo: "9001" } },
    { voucher_number: "111", package_type: "swish קלאסיק", raw_extras: { CouponNo: "9002" } },
  ];
  const pv = [
    { voucher_number: "111", package_type: "classic&more", raw_extras: { _provider_coupon_no: "9001" } },
    { voucher_number: "111", package_type: "classic&more", raw_extras: { _provider_coupon_no: "9001" } },
    { voucher_number: "111", package_type: "classic&more", raw_extras: { _provider_coupon_no: "9001" } },
    { voucher_number: "111", package_type: "classic&more", raw_extras: { _provider_coupon_no: "9002" } },
  ];
  const audit = buildVoucherQuantityAudit(ez, pv);
  const c9001 = audit.find((l) => l.couponNo === "9001");
  assertEquals(c9001?.easygoCount, 1);
  assertEquals(c9001?.providerCount, 3);
  assertEquals(c9001?.status, "over");
});
