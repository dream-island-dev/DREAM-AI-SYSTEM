// Mirror of supabase/functions/_shared/voucherReconciliationStrategy.ts (UI only).

const STRATEGIES = [
  {
    match: (name) => /nofshonit|נופשונית/i.test(name),
    key: "Nofshonit",
    matchMode: "exact",
    acceptedFormats: ["xlsx", "csv"],
    easygoRole: "שוברים שהוזמנו במערכת",
    providerRole: "שוברים שמומשו מול נופשונית",
    joinRule: "מזהה לקוח (ספק) = CouponNo (איזיגו)",
    easygoColumns: "CouponNo · CouponDesc",
    providerColumns: "מזהה לקוח · וריאנט · אסמכתא",
    packageRule: "וריאנט ↔ CouponDesc",
    filterNote: "סינון לחברת שוברים «נופשונית»",
  },
  {
    match: (name) => /police|שוטר/i.test(name),
    key: "Police Funds",
    matchMode: "suffix_5",
    acceptedFormats: ["pdf", "xlsx", "csv"],
    easygoRole: "שוברי קרנות השוטרים באיזיגו",
    providerRole: "מימושים מ-PDF (שוטרים)",
    joinRule: "5 ספרות אחרונות של CouponNo = מספר שובר ב-PDF",
    easygoColumns: "CouponNo (6 ספרות)",
    providerColumns: "מספר שובר · סכום",
    packageRule: "סכום → חבילת שוטרים",
    filterNote: "PDF: שורות «שוטרים» בלבד",
  },
  {
    match: (name) => /hever|חבר/i.test(name),
    key: "Hever",
    matchMode: "suffix_5",
    acceptedFormats: ["pdf", "xlsx", "csv"],
    easygoRole: "שוברי חבר באיזיגו",
    providerRole: "מימושים מ-PDF (חבר)",
    joinRule: "5 ספרות אחרונות של CouponNo = מספר שובר ב-PDF",
    easygoColumns: "CouponNo (6 ספרות)",
    providerColumns: "מספר שובר · סכום",
    packageRule: "סכום → חבילת חבר",
    filterNote: "PDF: שורות «חבר» בלבד",
  },
  {
    match: (name) => /pais|פיס/i.test(name),
    key: "Pais Plus",
    matchMode: "truncate_4",
    acceptedFormats: ["csv", "xlsx"],
    easygoRole: "שוברי פיס פלוס / מולטי פס באיזיגו",
    providerRole: "מימושים מדוח מולטי פס",
    joinRule: "בסיס CouponNo (ללא 4 ספרות סיום) = עמודת «שם»",
    easygoColumns: "CouponNo · CouponDesc",
    providerColumns: "שם · שם קופון הטבה",
    packageRule: "שם קופון הטבה ↔ CouponDesc",
  },
  {
    match: (name) => /dolce|דולצ/i.test(name),
    key: "Dolce Vita",
    matchMode: "truncate_4",
    acceptedFormats: ["csv", "xlsx"],
    easygoRole: "שוברי דולצ'ה ויטה באיזיגו",
    providerRole: "מימושים מדוח ספק",
    joinRule: "truncate_4",
    easygoColumns: "CouponNo · CouponDesc",
    providerColumns: "מספר שובר · חבילה",
    packageRule: "חבילה ↔ CouponDesc",
  },
  {
    match: (name) => /hightech|הייטק/i.test(name),
    key: "Hightech Zone",
    matchMode: "truncate_4",
    acceptedFormats: ["xlsx", "csv"],
    easygoRole: "שוברי הייטק באיזיגו",
    providerRole: "מימושים מדוח ספק",
    joinRule: "truncate_4",
    easygoColumns: "CouponNo · CouponDesc",
    providerColumns: "מספר שובר · חבילה",
    packageRule: "חבילה ↔ CouponDesc",
  },
];

export function resolveVoucherStrategyUi(providerName) {
  if (!providerName) return null;
  return STRATEGIES.find((s) => s.match(providerName)) ?? null;
}

export const VOUCHER_FLOW_EXPLAINER =
  "דוח איזיגו = מה שהוזמן במערכת · דוח ספק = מה שמומש בפועל · ההתאמה מאמתת שהמימוש תואם להזמנה";
