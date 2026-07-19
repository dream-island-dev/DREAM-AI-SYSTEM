// Package grouping + quantity audit for voucher reconciliation (Nofshonit naming variants).

import {
  normalizePackageLabel,
  normalizeVoucherIdDigits,
  normalizeVoucherNumber,
  packageTypesMatch,
} from "./voucherImport.ts";

export type PackageMatchGroup =
  | "classic_day"
  | "classic_evening"
  | "classic_special"
  | "classic_general"
  | "deluxe_general"
  | "deluxe_special"
  | null;

const CLASSIC_RE = /classic|קלאסיק|קלאסי|classic&more|classic&dinner/i;
const DELUXE_RE = /deluxe|דלקס|דלאקס/i;

const GROUP_COMPAT: Record<string, string[]> = {
  classic_general: ["classic_general", "classic_day"],
  classic_day: ["classic_general", "classic_day"],
  classic_evening: ["classic_evening"],
  classic_special: ["classic_special", "classic_day", "classic_general", "classic_evening"],
  deluxe_general: ["deluxe_general", "deluxe_special"],
  deluxe_special: ["deluxe_general", "deluxe_special"],
};

/** Canonical bucket for quantity comparison (Nofshonit provider ↔ EZGO naming). */
export function packageMatchGroup(label: string | null | undefined): PackageMatchGroup {
  const n = normalizePackageLabel(label);
  if (!n) return null;

  const deluxe = DELUXE_RE.test(n);
  const classic = CLASSIC_RE.test(n);
  if (!classic && !deluxe) return null;

  const evening = /night|dinner|ערב|16:00|א-ד|א ד/.test(n);
  const day = /צהרים|lunch|כל השבוע|יום|day|בוקר|ארוחת צהר/.test(n);
  const special = /מבצע|special|ספיישל|חורף|יולי|קיץ/.test(n);

  if (deluxe) return special ? "deluxe_special" : "deluxe_general";
  if (evening) return "classic_evening";
  if (day) return "classic_day";
  if (special) return "classic_special";
  return "classic_general";
}

export function packageGroupsCompatible(a: PackageMatchGroup, b: PackageMatchGroup): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const compat = GROUP_COMPAT[a];
  return compat ? compat.includes(b) : false;
}

/** Enhanced package match — classic&more night ↔ classic&dinner, צהרים ↔ כל השבוע. */
export function packageTypesMatchEnhanced(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ga = packageMatchGroup(a);
  const gb = packageMatchGroup(b);
  if (ga && gb && packageGroupsCompatible(ga, gb)) return true;
  return packageTypesMatch(a, b);
}

const GROUP_LABEL_HE: Record<string, string> = {
  classic_day: "קלאסיק (יום / צהרים)",
  classic_evening: "קלאסיק (ערב / night)",
  classic_special: "קלאסיק מבצע",
  classic_general: "קלאסיק",
  deluxe_general: "דלאקס",
  deluxe_special: "דלאקס מבצע",
};

export function packageGroupLabelHe(group: PackageMatchGroup): string {
  return group ? (GROUP_LABEL_HE[group] ?? group) : "חבילה";
}

export type QuantityAuditLine = {
  key: string;
  couponNo: string | null;
  nationalId: string | null;
  packageGroup: string | null;
  packageLabel: string;
  easygoCount: number;
  providerCount: number;
  surplus: number;
  status: "ok" | "over" | "under";
};

type AuditRow = {
  voucher_number?: string | null;
  package_type?: string | null;
  raw_extras?: Record<string, unknown> | null;
};

function couponFromRow(row: AuditRow, side: "easygo" | "provider"): string | null {
  const extras = row.raw_extras ?? {};
  if (side === "easygo") {
    return normalizeVoucherNumber(String(extras.CouponNo ?? "")) || null;
  }
  const coupon = String(extras._provider_coupon_no ?? extras._provider_client_id ?? "").trim();
  return coupon ? normalizeVoucherNumber(coupon) || normalizeVoucherIdDigits(coupon) || coupon : null;
}

function quantityKey(row: AuditRow, side: "easygo" | "provider"): string {
  const coupon = couponFromRow(row, side);
  if (coupon) return `coupon:${normalizeVoucherIdDigits(coupon) || coupon}`;
  const tz = normalizeVoucherIdDigits(String(row.voucher_number ?? ""));
  const grp = packageMatchGroup(row.package_type) ?? "unknown";
  return `tz:${tz}:${grp}`;
}

function samplePackageLabel(rows: AuditRow[]): string {
  const pkg = rows.find((r) => String(r.package_type ?? "").trim())?.package_type;
  return String(pkg ?? "").trim() || "—";
}

/** Compare EZGO booked vouchers vs provider redemptions per CouponNo (or ת.ז.+חבילה). */
export function buildVoucherQuantityAudit(
  easygoRows: AuditRow[],
  providerRows: AuditRow[],
): QuantityAuditLine[] {
  const ezMap = new Map<string, AuditRow[]>();
  const pvMap = new Map<string, AuditRow[]>();

  for (const r of easygoRows) {
    const k = quantityKey(r, "easygo");
    if (!ezMap.has(k)) ezMap.set(k, []);
    ezMap.get(k)!.push(r);
  }
  for (const r of providerRows) {
    const k = quantityKey(r, "provider");
    if (!pvMap.has(k)) pvMap.set(k, []);
    pvMap.get(k)!.push(r);
  }

  const keys = new Set([...ezMap.keys(), ...pvMap.keys()]);
  const lines: QuantityAuditLine[] = [];

  for (const key of keys) {
    const ez = ezMap.get(key) ?? [];
    const pv = pvMap.get(key) ?? [];
    const easygoCount = ez.length;
    const providerCount = pv.length;
    const surplus = providerCount - easygoCount;
    let status: QuantityAuditLine["status"] = "ok";
    if (surplus > 0) status = "over";
    else if (surplus < 0) status = "under";

    const sample = ez[0] ?? pv[0];
    const couponRaw = couponFromRow(sample, ez.length ? "easygo" : "provider");
    const grp = packageMatchGroup(sample?.package_type);

    lines.push({
      key,
      couponNo: couponRaw,
      nationalId: normalizeVoucherIdDigits(String(sample?.voucher_number ?? "")) || null,
      packageGroup: grp,
      packageLabel: samplePackageLabel([...ez, ...pv]),
      easygoCount,
      providerCount,
      surplus,
      status,
    });
  }

  return lines.sort((a, b) => {
    if (a.status !== b.status) {
      const order = { over: 0, under: 1, ok: 2 };
      return order[a.status] - order[b.status];
    }
    return Math.abs(b.surplus) - Math.abs(a.surplus);
  });
}
