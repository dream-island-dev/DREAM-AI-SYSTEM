/**
 * Simulate run_voucher_reconciliation FIFO logic for Nofshonit multi-package orders.
 * Mirrors migration 237 behavior in TypeScript for local validation.
 */
import { readFileSync } from "node:fs";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  csvUtf8BytesToMatrix,
  matrixToVoucherRows,
  filterEasygoRowsByProvider,
  packageTypesMatch,
  voucherNumbersMatchLocal,
  normalizeVoucherIdDigits,
  normalizeVoucherNumber,
} from "../supabase/functions/_shared/voucherImport.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "../supabase/functions/_shared/nofshonitNationalId.ts";

type EzRec = {
  id: number;
  voucher_number: string;
  package_type: string | null;
  couponNo: string | null;
};

type ProvRec = {
  id: number;
  voucher_number: string;
  package_type: string | null;
  couponNo: string | null;
};

function simulate(
  easygo: EzRec[],
  provider: ProvRec[],
): { matched: number; duplicate: number; packageMismatch: number; reuse: number } {
  const matchedIds = new Set<number>();
  let matched = 0;
  let duplicate = 0;
  let packageMismatch = 0;
  let reuse = 0;

  for (const p of provider) {
    let candidates = easygo.filter(
      (e) =>
        !matchedIds.has(e.id) &&
        voucherNumbersMatchLocal("exact", p.voucher_number, e.voucher_number),
    );

    if (p.package_type?.trim()) {
      const pkg = candidates.filter(
        (e) => e.package_type && packageTypesMatch(p.package_type!, e.package_type),
      );
      if (pkg.length >= 1) candidates = [pkg[0]];
    }

    if (candidates.length > 1 && p.couponNo) {
      const byCoupon = candidates.filter((e) =>
        voucherNumbersMatchLocal("exact", p.couponNo!, e.couponNo ?? ""),
      );
      if (byCoupon.length >= 1) candidates = [byCoupon[0]];
    }

    if (candidates.length === 0) {
      const already = easygo.find((e) =>
        voucherNumbersMatchLocal("exact", p.voucher_number, e.voucher_number),
      );
      if (already) {
        reuse++;
        matched++;
        if (
          p.package_type?.trim() &&
          already.package_type?.trim() &&
          !packageTypesMatch(p.package_type, already.package_type)
        ) {
          packageMismatch++;
        }
        continue;
      }
    }

    if (candidates.length === 1) {
      const e = candidates[0];
      if (
        p.package_type?.trim() &&
        e.package_type?.trim() &&
        !packageTypesMatch(p.package_type, e.package_type)
      ) {
        packageMismatch++;
      } else {
        matched++;
        matchedIds.add(e.id);
      }
    } else if (candidates.length > 1) {
      duplicate++;
    }
  }

  return { matched, duplicate, packageMismatch, reuse };
}

const ezPath = "c:/Users/mikek/Downloads/איזיגו.csv";
const provPath = "c:/Users/mikek/Downloads/נופשונית (1).xlsx";
if (!readFileSync(ezPath, { flag: "r" })) process.exit(0);

const { rows } = matrixToVoucherRows(csvUtf8BytesToMatrix(readFileSync(ezPath)));
const nof = filterEasygoRowsByProvider(rows, "Nofshonit");
const idx = buildNofshonitEasygoIndex(nof);

const easygo: EzRec[] = nof.map((r, i) => ({
  id: i + 1,
  voucher_number: normalizeVoucherIdDigits(String(r["מזהה"] ?? "")),
  package_type: String(r.CouponDesc ?? "").trim() || null,
  couponNo: normalizeVoucherNumber(r.CouponNo) || null,
}));

const wb = XLSX.read(readFileSync(provPath), { type: "buffer" });
const provRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<
  string,
  unknown
>[];

const provider: ProvRec[] = provRows.map((r, i) => {
  const raw = String(r["מזהה לקוח"] ?? "");
  const { nationalId, resolvedFrom } = resolveNofshonitProviderToNationalId(
    raw,
    idx.couponToNationalId,
    idx.byNationalId,
  );
  return {
    id: i + 1,
    voucher_number: nationalId ?? "",
    package_type: String(r["וריאנט"] ?? "").trim() || null,
    couponNo: resolvedFrom === "coupon_lookup" ? raw : null,
  };
});

const result = simulate(easygo, provider);
console.log("FIFO simulation:", result);
console.log("provider lines:", provider.length, "| easygo:", easygo.length);
