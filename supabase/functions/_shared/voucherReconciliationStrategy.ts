// Per-provider reconciliation strategies — single source of truth for how each
// external voucher report pairs with the EZGO coupons export.

export type VoucherProviderKey =
  | "Nofshonit"
  | "Hever"
  | "Police Funds"
  | "Pais Plus"
  | "Dolce Vita"
  | "Hightech Zone";

export type VoucherMatchMode = "exact" | "truncate_4" | "suffix_5";
export type VoucherFileFormat = "xlsx" | "csv" | "pdf";
export type ProviderPresetKind = "nofshonit" | "multipass" | "hever_pdf" | "generic";

export type VoucherProviderProfile = {
  easygoCompanyPatterns: RegExp[];
  easygoVoucherHeader: string;
  easygoPackageHeader: string;
  easygoGuestHeader: string;
  easygoPhoneHeader: string;
  easygoOrderHeader: string;
  easygoAmountHeader: string;
  easygoArrivalHeader: string;
  pdfOrgFilter?: RegExp;
};

export type VoucherReconciliationStrategy = {
  key: VoucherProviderKey;
  matchMode: VoucherMatchMode;
  presetKind: ProviderPresetKind;
  acceptedFormats: VoucherFileFormat[];
  profile: VoucherProviderProfile;
  /** Hebrew copy for staff UI + API responses */
  ui: {
    easygoRole: string;
    providerRole: string;
    joinRule: string;
    easygoColumns: string;
    providerColumns: string;
    packageRule: string;
    filterNote?: string;
  };
};

const STRATEGIES: Record<VoucherProviderKey, VoucherReconciliationStrategy> = {
  Nofshonit: {
    key: "Nofshonit",
    matchMode: "exact",
    presetKind: "nofshonit",
    acceptedFormats: ["xlsx", "csv"],
    profile: {
      easygoCompanyPatterns: [/נופשונית/i, /תשורות חן/i],
      easygoVoucherHeader: "מזהה",
      easygoPackageHeader: "CouponDesc",
      easygoGuestHeader: "שם לקוח",
      easygoPhoneHeader: "טלפון",
      easygoOrderHeader: "מס. הזמנה",
      easygoAmountHeader: "מחיר",
      easygoArrivalHeader: "ת. התחלה",
    },
    ui: {
      easygoRole: "שוברים שהוזמנו במערכת — זיהוי לפי ת.ז. (מזהה)",
      providerRole: "מימושים בפועל — מזהה לקוח = ת.ז. (או CouponNo שממופה לת.ז.)",
      joinRule: "תעודת זהות: מזהה (איזיגו) = מזהה לקוח (ספק) · כפילויות נפרדות לפי חבילה",
      easygoColumns: "מזהה (ת.ז.) · CouponDesc · מס. הזמנה",
      providerColumns: "מזהה לקוח · וריאנט · אסמכתא",
      packageRule: "וריאנט ↔ CouponDesc (דלאקס/קלאסיק) — מפריד כמה שוברים לאותה הזמנה",
      filterNote: "אותה הזמנה יכולה לכלול כמה אנשים — ההתאמה לפי ת.ז.+חבילה, לא לפי מספר הזמנה",
    },
  },
  Hever: {
    key: "Hever",
    matchMode: "suffix_5",
    presetKind: "hever_pdf",
    acceptedFormats: ["pdf", "xlsx", "csv"],
    profile: {
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
    ui: {
      easygoRole: "שוברי חבר שהוזמנו באיזיגו",
      providerRole: "מימושים מדוח PDF משולב חבר",
      joinRule: "5 ספרות אחרונות של CouponNo (איזיגו) = מספר שובר בדוח PDF",
      easygoColumns: "CouponNo (6 ספרות) · CouponDesc",
      providerColumns: "מספר שובר (5 ספרות) · סכום → חבילה",
      packageRule: "סכום יחידה ב-PDF → סוג חבילה (קלאסיק/דלאקס)",
      filterNote: "PDF: רק שורות «חבר» (לא שוטרים)",
    },
  },
  "Police Funds": {
    key: "Police Funds",
    matchMode: "suffix_5",
    presetKind: "hever_pdf",
    acceptedFormats: ["pdf", "xlsx", "csv"],
    profile: {
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
    ui: {
      easygoRole: "שוברי קרנות השוטרים שהוזמנו באיזיגו",
      providerRole: "מימושים מדוח PDF משולב שוטרים",
      joinRule: "5 ספרות אחרונות של CouponNo = מספר שובר בדוח PDF",
      easygoColumns: "CouponNo (6 ספרות) · CouponDesc",
      providerColumns: "מספר שובר · סכום → חבילה",
      packageRule: "סכום יחידה → חבילת שוטרים (קלאסיק/דלאקס)",
      filterNote: "PDF: רק שורות «שוטרים»",
    },
  },
  "Pais Plus": {
    key: "Pais Plus",
    matchMode: "truncate_4",
    presetKind: "multipass",
    acceptedFormats: ["csv", "xlsx"],
    profile: {
      easygoCompanyPatterns: [/פיס פלוס/i, /דולצ'ה ויטה/i, /מפעל הפיס/i],
      easygoVoucherHeader: "CouponNo",
      easygoPackageHeader: "CouponDesc",
      easygoGuestHeader: "שם לקוח",
      easygoPhoneHeader: "טלפון",
      easygoOrderHeader: "מס. הזמנה",
      easygoAmountHeader: "מחיר",
      easygoArrivalHeader: "ת. התחלה",
    },
    ui: {
      easygoRole: "שוברי פיס פלוס / מולטי פס שהוזמנו באיזיגו",
      providerRole: "מימושים מדוח מולטי פס",
      joinRule: "בסיס שובר (ללא 4 ספרות סיומת) = עמודת «שם» בדוח ספק",
      easygoColumns: "CouponNo (מלא) · CouponDesc",
      providerColumns: "שם (מספר שובר) · שם קופון הטבה",
      packageRule: "שם קופון הטבה ↔ CouponDesc (Classic/Deluxe)",
    },
  },
  "Dolce Vita": {
    key: "Dolce Vita",
    matchMode: "truncate_4",
    presetKind: "multipass",
    acceptedFormats: ["csv", "xlsx"],
    profile: {
      easygoCompanyPatterns: [/דולצ'ה ויטה/i],
      easygoVoucherHeader: "CouponNo",
      easygoPackageHeader: "CouponDesc",
      easygoGuestHeader: "שם לקוח",
      easygoPhoneHeader: "טלפון",
      easygoOrderHeader: "מס. הזמנה",
      easygoAmountHeader: "מחיר",
      easygoArrivalHeader: "ת. התחלה",
    },
    ui: {
      easygoRole: "שוברי דולצ'ה ויטה שהוזמנו באיזיגו",
      providerRole: "מימושים מדוח ספק",
      joinRule: "truncate_4 — בסיס CouponNo = מספר בדוח ספק",
      easygoColumns: "CouponNo · CouponDesc",
      providerColumns: "מספר שובר · חבילה",
      packageRule: "חבילה ↔ CouponDesc",
    },
  },
  "Hightech Zone": {
    key: "Hightech Zone",
    matchMode: "truncate_4",
    presetKind: "generic",
    acceptedFormats: ["xlsx", "csv"],
    profile: {
      easygoCompanyPatterns: [/hightech/i, /הייטק/i],
      easygoVoucherHeader: "CouponNo",
      easygoPackageHeader: "CouponDesc",
      easygoGuestHeader: "שם לקוח",
      easygoPhoneHeader: "טלפון",
      easygoOrderHeader: "מס. הזמנה",
      easygoAmountHeader: "מחיר",
      easygoArrivalHeader: "ת. התחלה",
    },
    ui: {
      easygoRole: "שוברי הייטק שהוזמנו באיזיגו",
      providerRole: "מימושים מדוח ספק",
      joinRule: "truncate_4",
      easygoColumns: "CouponNo · CouponDesc",
      providerColumns: "מספר שובר · חבילה",
      packageRule: "חבילה ↔ CouponDesc",
    },
  },
};

export function resolveVoucherStrategy(providerName: string): VoucherReconciliationStrategy | null {
  const norm = providerName.trim().toLowerCase();
  if (norm.includes("nofshonit") || norm.includes("נופשונית")) return STRATEGIES.Nofshonit;
  if (norm.includes("police") || norm.includes("שוטר")) return STRATEGIES["Police Funds"];
  if (norm.includes("hever") || norm.includes("חבר")) return STRATEGIES.Hever;
  if (norm.includes("pais") || norm.includes("פיס")) return STRATEGIES["Pais Plus"];
  if (norm.includes("dolce") || norm.includes("דולצ")) return STRATEGIES["Dolce Vita"];
  if (norm.includes("hightech") || norm.includes("הייטק")) return STRATEGIES["Hightech Zone"];
  return null;
}

/** @deprecated use resolveVoucherStrategy().profile */
export function resolveVoucherProviderProfile(providerName: string): VoucherProviderProfile | null {
  return resolveVoucherStrategy(providerName)?.profile ?? null;
}

export const VOUCHER_PROVIDER_PROFILES = Object.fromEntries(
  Object.values(STRATEGIES).map((s) => [s.key, s.profile]),
) as Record<VoucherProviderKey, VoucherProviderProfile>;

export function strategySummaryForApi(strategy: VoucherReconciliationStrategy) {
  return {
    provider: strategy.key,
    matchMode: strategy.matchMode,
    presetKind: strategy.presetKind,
    acceptedFormats: strategy.acceptedFormats,
    ...strategy.ui,
  };
}
