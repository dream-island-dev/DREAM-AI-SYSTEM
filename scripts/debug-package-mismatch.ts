import { readFileSync } from "node:fs";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  csvUtf8BytesToMatrix,
  matrixToVoucherRows,
  filterEasygoRowsByProvider,
  packageTypesMatch,
  normalizeVoucherIdDigits,
} from "../supabase/functions/_shared/voucherImport.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "../supabase/functions/_shared/nofshonitNationalId.ts";

const ezPath = "c:/Users/mikek/Downloads/איזיגו.csv";
const provPath = "c:/Users/mikek/Downloads/נופשונית (1).xlsx";

const { rows } = matrixToVoucherRows(csvUtf8BytesToMatrix(readFileSync(ezPath)));
const nof = filterEasygoRowsByProvider(rows, "Nofshonit");
const idx = buildNofshonitEasygoIndex(nof);

const wb = XLSX.read(readFileSync(provPath), { type: "buffer" });
const prov = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

// Cases from screenshot
const cases = ["34252510", "314116344", "59134684", "059134684"];
for (const key of cases) {
  const norm = normalizeVoucherIdDigits(key);
  console.log("\n===", key, "norm", norm, "===");
  const ez = nof.filter((r) => normalizeVoucherIdDigits(String(r["מזהה"] ?? "")) === norm);
  console.log("EZGO rows:", ez.length);
  for (const r of ez) {
    console.log("  CouponNo:", r.CouponNo, "|", String(r.CouponDesc).slice(0, 55));
  }
  const pr = prov.filter((r) => {
    const raw = String(r["מזהה לקוח"] ?? "");
    const { nationalId } = resolveNofshonitProviderToNationalId(raw, idx.couponToNationalId, idx.byNationalId);
    return nationalId === norm || normalizeVoucherIdDigits(raw) === norm;
  });
  console.log("Provider rows:", pr.length);
  for (const r of pr) {
    console.log("  מזהה לקוח:", r["מזהה לקוח"], "|", String(r["וריאנט"]).slice(0, 55));
    const variant = String(r["וריאנט"] ?? "");
    for (const e of ez) {
      const desc = String(e.CouponDesc ?? "");
      const m = packageTypesMatch(variant, desc);
      if (m) console.log("    MATCHES EZGO", e.CouponNo, desc.slice(0, 45));
    }
  }
}

console.log("\nTOTALS: EZGO", nof.length, "provider", prov.length);
