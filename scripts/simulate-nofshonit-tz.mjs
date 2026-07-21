import { readFileSync } from "node:fs";
import { csvUtf8BytesToMatrix, matrixToVoucherRows, filterEasygoRowsByProvider } from "../supabase/functions/_shared/voucherImport.ts";
import {
  buildNofshonitEasygoIndex,
  resolveNofshonitProviderToNationalId,
} from "../supabase/functions/_shared/nofshonitNationalId.ts";

const ezPath = "c:/Users/mikek/Downloads/איזיגו.csv";
const bytes = readFileSync(ezPath);
const matrix = csvUtf8BytesToMatrix(bytes);
const { rows } = matrixToVoucherRows(matrix);
const nof = filterEasygoRowsByProvider(rows, "Nofshonit");
const withMezahe = nof.filter((r) => String(r["מזהה"] || "").trim());
console.log("nof rows", nof.length, "with מזהה", withMezahe.length);
console.log("sample מזהה", withMezahe.slice(0, 3).map((r) => ({ מזהה: r["מזהה"], CouponNo: r.CouponNo })));

const idx = buildNofshonitEasygoIndex(nof);
console.log("unique ת.ז.", idx.byNationalId.size, "coupon map", idx.couponToNationalId.size);
