// Nofshonit — match key is national ID (ת.ז.), not CouponNo / order number.
// Provider מזהה לקוח may hold ת.ז. OR CouponNo; EZGO מזהה = ת.ז., CouponNo = per-person voucher.

import {
  normalizeVoucherIdDigits,
  normalizeVoucherNumber,
  packageTypesMatch,
  type VoucherRow,
} from "./voucherImport.ts";

export type NofshonitEasygoEntry = {
  nationalId: string;
  couponNo: string | null;
  packageType: string | null;
  guestName: string | null;
  orderNumber: string | null;
};

/** Build lookup from filtered EZGO rows (Nofshonit company). */
export function buildNofshonitEasygoIndex(rows: VoucherRow[]): {
  byNationalId: Map<string, NofshonitEasygoEntry[]>;
  couponToNationalId: Map<string, string>;
} {
  const byNationalId = new Map<string, NofshonitEasygoEntry[]>();
  const couponToNationalId = new Map<string, string>();

  for (const row of rows) {
    const nationalId = normalizeVoucherIdDigits(String(row["מזהה"] ?? ""));
    const couponRaw = normalizeVoucherNumber(row["CouponNo"]);
    const couponNo = couponRaw ? normalizeVoucherIdDigits(couponRaw) : null;
    if (!nationalId) continue;

    const entry: NofshonitEasygoEntry = {
      nationalId,
      couponNo,
      packageType: String(row["CouponDesc"] ?? row["SIName"] ?? "").trim() || null,
      guestName: String(row["שם לקוח"] ?? "").trim() || null,
      orderNumber: String(row["מס. הזמנה"] ?? "").trim() || null,
    };

    const list = byNationalId.get(nationalId) ?? [];
    list.push(entry);
    byNationalId.set(nationalId, list);

    if (couponNo) couponToNationalId.set(couponNo, nationalId);
  }

  return { byNationalId, couponToNationalId };
}

/**
 * Resolve provider מזהה לקוח to EZGO national ID (ת.ז.).
 * If value is a CouponNo in the batch, map to that guest's מזהה.
 */
export function resolveNofshonitProviderToNationalId(
  rawProviderId: unknown,
  couponToNationalId: Map<string, string>,
  byNationalId: Map<string, NofshonitEasygoEntry[]>,
): { nationalId: string | null; resolvedFrom: "direct_tz" | "coupon_lookup" | null } {
  const normalized = normalizeVoucherIdDigits(String(rawProviderId ?? ""));
  if (!normalized) return { nationalId: null, resolvedFrom: null };

  if (byNationalId.has(normalized)) {
    return { nationalId: normalized, resolvedFrom: "direct_tz" };
  }

  const viaCoupon = couponToNationalId.get(normalized);
  if (viaCoupon) {
    return { nationalId: viaCoupon, resolvedFrom: "coupon_lookup" };
  }

  return { nationalId: null, resolvedFrom: null };
}
