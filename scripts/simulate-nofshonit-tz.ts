import { readFileSync } from "node:fs";
import * as XLSX from "npm:xlsx@0.18.5";
import { csvUtf8BytesToMatrix, matrixToVoucherRows, filterEasygoRowsByProvider } from "../supabase/functions/_shared/voucherImport.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "../supabase/functions/_shared/nofshonitNationalId.ts";

const ezPath = "c:/Users/mikek/Downloads/איזיגו.csv";
const provPath = "c:/Users/mikek/Downloads/נופשונית (1).xlsx";

const bytes = readFileSync(ezPath);
const { rows } = matrixToVoucherRows(csvUtf8BytesToMatrix(bytes));
const nof = filterEasygoRowsByProvider(rows, "Nofshonit");
const idx = buildNofshonitEasygoIndex(nof);

const wb = XLSX.read(readFileSync(provPath), { type: "buffer" });
const prov = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];

let direct = 0;
let coupon = 0;
let miss = 0;
for (const p of prov) {
  const { nationalId, resolvedFrom } = resolveNofshonitProviderToNationalId(
    p["מזהה לקוח"],
    idx.couponToNationalId,
    idx.byNationalId,
  );
  if (!nationalId) miss++;
  else if (resolvedFrom === "coupon_lookup") coupon++;
  else direct++;
}

const multiTz = [...idx.byNationalId.entries()].filter(([, v]) => v.length > 1);
console.log("EZGO:", nof.length, "rows,", idx.byNationalId.size, "unique ת.ז.");
console.log("Provider:", prov.length, "rows → resolved:", direct, "direct ת.ז. +", coupon, "via CouponNo, miss:", miss);
console.log("ת.ז. with 2+ vouchers (same person/order):", multiTz.length);
