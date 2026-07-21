/** Quick simulation of migration 238 matching rules */
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

type Ez = { id: number; tz: string; pkg: string | null; coupon: string | null };
type Pr = { id: number; tz: string; pkg: string | null; coupon: string | null };

function match238(easygo: Ez[], provider: Pr[]) {
  const matched = new Set<number>();
  const stats = { matched: 0, over: 0, pkgMismatch: 0, missingEz: 0, dup: 0 };

  for (const p of provider) {
    let cands = easygo.filter((e) => !matched.has(e.id) && e.tz === p.tz);

    if (p.coupon) {
      const byC = cands.filter((e) => voucherNumbersMatchLocal("exact", p.coupon!, e.coupon ?? ""));
      if (byC.length) cands = [byC[0]];
    }

    if (cands.length > 1 && p.pkg?.trim()) {
      const byP = cands.filter((e) => e.pkg && packageTypesMatch(p.pkg!, e.pkg));
      if (byP.length) cands = [byP[0]];
      else cands = [];
    }

    if (cands.length === 1) {
      matched.add(cands[0].id);
      stats.matched++;
      continue;
    }

    if (cands.length === 0 && p.pkg?.trim()) {
      const booked = easygo.filter((e) => e.tz === p.tz && e.pkg && packageTypesMatch(p.pkg!, e.pkg));
      if (booked.length) {
        const ez = booked[0];
        if (matched.has(ez.id)) stats.over++;
        else { matched.add(ez.id); stats.matched++; }
      } else stats.missingEz++;
      continue;
    }

    if (cands.length > 1) stats.dup++;
  }

  return stats;
}

const { rows } = matrixToVoucherRows(csvUtf8BytesToMatrix(readFileSync("c:/Users/mikek/Downloads/איזיגו.csv")));
const nof = filterEasygoRowsByProvider(rows, "Nofshonit");
const idx = buildNofshonitEasygoIndex(nof);
const prov = XLSX.utils.sheet_to_json(
  XLSX.read(readFileSync("c:/Users/mikek/Downloads/נופשונית (1).xlsx"), { type: "buffer" }).Sheets[
    XLSX.read(readFileSync("c:/Users/mikek/Downloads/נופשונית (1).xlsx"), { type: "buffer" }).SheetNames[0]
  ],
  { defval: "" },
) as Record<string, unknown>[];

const easygo: Ez[] = nof.map((r, i) => ({
  id: i + 1,
  tz: normalizeVoucherIdDigits(String(r["מזהה"] ?? "")),
  pkg: String(r.CouponDesc ?? "").trim() || null,
  coupon: normalizeVoucherNumber(r.CouponNo) || null,
}));

const provider: Pr[] = prov.map((r, i) => {
  const raw = String(r["מזהה לקוח"] ?? "");
  const { nationalId, resolvedFrom } = resolveNofshonitProviderToNationalId(raw, idx.couponToNationalId, idx.byNationalId);
  const normRaw = normalizeVoucherIdDigits(raw);
  const coupon =
    resolvedFrom === "coupon_lookup" || idx.couponToNationalId.has(normRaw) ? raw : null;
  return {
    id: i + 1,
    tz: nationalId ?? "",
    pkg: String(r["וריאנט"] ?? "").trim() || null,
    coupon,
  };
});

const s = match238(easygo, provider);
console.log("238 simulation:", s);
console.log("totals ez", easygo.length, "prov", provider.length, "surplus", provider.length - easygo.length);
