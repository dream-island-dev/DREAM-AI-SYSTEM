// Provider-specific voucher reconciliation rules (ground truth: Mike's 2026-07-19 samples).

export type VoucherProviderKey =
  | "Nofshonit"
  | "Hever"
  | "Police Funds"
  | "Pais Plus"
  | "Dolce Vita"
  | "Hightech Zone";

export type VoucherProviderProfile = {
  /** Substrings matched against EasyGo `חברת שוברים` (case-insensitive). */
  easygoCompanyPatterns: RegExp[];
  /** EasyGo export column for voucher key when this provider is selected. */
  easygoVoucherHeader: string;
  easygoPackageHeader: string;
  easygoGuestHeader: string;
  easygoPhoneHeader: string;
  easygoOrderHeader: string;
  easygoAmountHeader: string;
  easygoArrivalHeader: string;
  /** PDF org token filter — only rows whose org contains this (Hever/Police combined PDF). */
  pdfOrgFilter?: RegExp;
};

export const VOUCHER_PROVIDER_PROFILES: Record<VoucherProviderKey, VoucherProviderProfile> = {
  Nofshonit: {
    easygoCompanyPatterns: [/נופשונית/i, /תשורות חן/i],
    easygoVoucherHeader: "מזהה",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
  },
  Hever: {
    easygoCompanyPatterns: [/חבר משרתי/i, /הקבע והגמלאים/i],
    easygoVoucherHeader: "CouponNo",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
    pdfOrgFilter: /חבר(?!ת)/i,
  },
  "Police Funds": {
    easygoCompanyPatterns: [/קרנות השוטרים/i, /שוטרים/i],
    easygoVoucherHeader: "CouponNo",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
    pdfOrgFilter: /שוטרים/i,
  },
  "Pais Plus": {
    easygoCompanyPatterns: [/פיס פלוס/i, /דולצ'ה ויטה/i, /מפעל הפיס/i],
    easygoVoucherHeader: "CouponNo",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
  },
  "Dolce Vita": {
    easygoCompanyPatterns: [/דולצ'ה ויטה/i],
    easygoVoucherHeader: "CouponNo",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
  },
  "Hightech Zone": {
    easygoCompanyPatterns: [/hightech/i, /הייטק/i],
    easygoVoucherHeader: "CouponNo",
    easygoPackageHeader: "CouponDesc",
    easygoGuestHeader: "שם לקוח",
    easygoPhoneHeader: "טלפון",
    easygoOrderHeader: "מס. הזמנה",
    easygoAmountHeader: "מחיר",
    easygoArrivalHeader: "ת. התחלה",
  },
};

/** Resolve profile from voucher_providers.provider_name (ilike-safe). */
export function resolveVoucherProviderProfile(providerName: string): VoucherProviderProfile | null {
  const norm = providerName.trim().toLowerCase();
  if (norm.includes("nofshonit") || norm.includes("נופשונית")) return VOUCHER_PROVIDER_PROFILES.Nofshonit;
  if (norm.includes("police") || norm.includes("שוטר")) return VOUCHER_PROVIDER_PROFILES["Police Funds"];
  if (norm.includes("hever") || norm.includes("חבר")) return VOUCHER_PROVIDER_PROFILES.Hever;
  if (norm.includes("pais") || norm.includes("פיס")) return VOUCHER_PROVIDER_PROFILES["Pais Plus"];
  if (norm.includes("dolce") || norm.includes("דולצ")) return VOUCHER_PROVIDER_PROFILES["Dolce Vita"];
  if (norm.includes("hightech") || norm.includes("הייטק")) return VOUCHER_PROVIDER_PROFILES["Hightech Zone"];
  return null;
}

/** Unit price (₪) → package label for Hever/Police PDF rows (no explicit package column). */
export function inferHeverPolicePackage(unitPrice: number, org: string): string | null {
  const isPolice = /שוטר/i.test(org);
  const p = Math.round(unitPrice * 100) / 100;
  if (isPolice) {
    if (p >= 690 && p <= 700) return "שוטרים מבצע דלאקס";
    if (p >= 775 && p <= 785) return "שוטרים דלאקס";
    if (p >= 448 && p <= 458) return "שוטרים מבצע קלאסיק";
    if (p >= 538 && p <= 548) return "שוטרים קלאסיק וארוחת צהרים";
  } else {
    if (p >= 775 && p <= 785) return "חבר דלאקס";
    if (p >= 755 && p <= 765) return "חבר דלאקס";
    if (p >= 528 && p <= 538) return "חבר קלאסיק עם ארוחת צהרים";
    if (p >= 538 && p <= 548) return "חבר קלאסיק עם ארוחת צהרים";
    if (p >= 2525 && p <= 2545) return "חבר פרימיום";
  }
  return null;
}
