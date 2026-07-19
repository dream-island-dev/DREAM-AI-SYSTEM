import fs from "fs";
import XLSX from "xlsx";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ; continue;
    }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((c) => c.replace(/^"|"$/g, ""));
}

const raw = fs.readFileSync("c:/Users/mikek/Downloads/איזיגו.csv", "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter(Boolean);
const hdr = parseCsvLine(lines[0]);
const idx = (name) => hdr.indexOf(name);
const idxLast = (name) => hdr.lastIndexOf(name);
const cols = ["CouponNo", "מזהה", "מזהה שובר", "מס. הזמנה", "מס. לקוח", "iCouponItemId"];
console.log("hdr indices", Object.fromEntries(cols.map((c) => [c, idx(c)])));

const ezNof = [];
for (const line of lines.slice(1)) {
  const v = parseCsvLine(line);
  const companyIdx = hdr.lastIndexOf("חברת שוברים");
  const company = companyIdx >= 0 ? v[companyIdx] : "";
  if (!String(company).includes("נופשונית")) continue;
  ezNof.push({
    CouponNo: v[idx("CouponNo")],
    CouponDesc: v[idx("CouponDesc")],
    מזהה: v[idxLast("מזהה")],
    mezaheShover: v[idx("מזהה שובר")],
    order: v[idx("מס. הזמנה")],
    client: v[idx("מס. לקוח")],
    item: v[idx("iCouponItemId")],
  });
}
console.log("ez nof rows", ezNof.length);
console.log("sample", ezNof.slice(2, 5));

const prov = XLSX.readFile("c:/Users/mikek/Downloads/נופשונית (1).xlsx");
const pr = XLSX.utils.sheet_to_json(prov.Sheets[prov.SheetNames[0]], { defval: "" });

const provById = new Map();
const provByAsm = new Map();
for (const r of pr) {
  const id = String(r["מזהה לקוח"] || "").replace(/^0+/, "");
  const asm = String(r["אסמכתא"] || "").replace(/^0+/, "");
  if (id) provById.set(id, (provById.get(id) || 0) + 1);
  if (asm) provByAsm.set(asm, (provByAsm.get(asm) || 0) + 1);
}

function countMatch(getter) {
  let hit = 0;
  for (const e of ezNof) {
    const k = String(getter(e) || "").replace(/^0+/, "");
    if (k && (provById.has(k) || provByAsm.has(k))) hit++;
  }
  return hit;
}

console.log("\nEZGO field hits provider מזהה לקוח or אסמכתא:");
console.log("  מזהה -> מזהה לקוח:", ezNof.filter((e) => provById.has(String(e.מזהה).replace(/^0+/, ""))).length);
console.log("  CouponNo -> אסמכתא:", ezNof.filter((e) => provByAsm.has(String(e.CouponNo).replace(/^0+/, ""))).length);
console.log("  CouponNo -> מזהה לקוח:", ezNof.filter((e) => provById.has(String(e.CouponNo).replace(/^0+/, ""))).length);
console.log("  מזהה -> אסמכתא:", ezNof.filter((e) => provByAsm.has(String(e.מזהה).replace(/^0+/, ""))).length);
console.log("  order -> אסמכתא:", ezNof.filter((e) => provByAsm.has(String(e.order).replace(/^0+/, ""))).length);
console.log("  client -> אסמכתא:", ezNof.filter((e) => provByAsm.has(String(e.client).replace(/^0+/, ""))).length);
console.log("  item -> אסמכתא:", ezNof.filter((e) => provByAsm.has(String(e.item).replace(/^0+/, ""))).length);

console.log("\nprovider unique מזהה לקוח", provById.size, "unique אסמכתא", provByAsm.size);

// Debug: why CouponNo hits מזהה לקוח?
const couponHits = ezNof.filter((e) => provById.has(String(e.CouponNo).replace(/^0+/, "")));
console.log("\nCouponNo exact in מזהה לקוח:", couponHits.length, "samples:", couponHits.slice(0, 3).map((e) => e.CouponNo));

// Check if CouponNo suffix matches מזהה לקוח or if מזהה column parses
const withMezahe = ezNof.filter((e) => e.מזהה);
console.log("rows with מזהה parsed:", withMezahe.length);
const mezaheHits = ezNof.filter((e) => e.מזהה && provById.has(String(e.מזהה).replace(/^0+/, "")));
console.log("מזהה hits מזהה לקוח:", mezaheHits.length);

// אסמכתא join
const asmHits = ezNof.filter((e) => provByAsm.has(String(e.CouponNo).replace(/^0+/, "")));
console.log("CouponNo in אסמכתא:", asmHits.length);

// Maybe אסמכתא = suffix of CouponNo?
let suffixHits = 0;
for (const e of ezNof) {
  const c = String(e.CouponNo).replace(/^0+/, "");
  for (const asm of provByAsm.keys()) {
    if (c.endsWith(asm) || asm.endsWith(c)) { suffixHits++; break; }
  }
}
console.log("CouponNo suffix/prefix overlap with אסמכתא:", suffixHits);

// Full reconciliation simulation: מזהה לקוח (provider) <-> CouponNo (easygo)
let matched = 0, missingEz = 0, missingProv = 0, pkgMismatch = 0;
const matchedCoupons = new Set();
for (const r of pr) {
  const provKey = String(r["מזהה לקוח"] || "").replace(/^0+/, "");
  const ez = ezNof.find((e) => String(e.CouponNo).replace(/^0+/, "") === provKey);
  if (!ez) { missingEz++; continue; }
  matchedCoupons.add(String(ez.CouponNo).replace(/^0+/, ""));
  matched++;
  const pv = String(r["וריאנט"] || "").toLowerCase();
  const ev = String(ez.CouponDesc || "").toLowerCase();
  const classic = /classic|קלאס/i.test(pv) && /classic|קלאס|קלאסיק/i.test(ev);
  const deluxe = /deluxe|דלקס|דלאקס/i.test(pv) && /deluxe|דלקס|דלאקס/i.test(ev);
  if (!classic && !deluxe && !(pv.includes(ev) || ev.includes(pv))) pkgMismatch++;
}
for (const e of ezNof) {
  const k = String(e.CouponNo).replace(/^0+/, "");
  if (!matchedCoupons.has(k)) missingProv++;
}
console.log("\n=== SIMULATED JOIN מזהה לקוח <-> CouponNo ===");
console.log("matched", matched, "missing_in_easygo", missingEz, "missing_in_provider", missingProv, "pkg_check_fail", pkgMismatch);

const sampleProv = pr.find((r) => String(r["מזהה לקוח"]) === "32257537");
if (sampleProv) {
  console.log("\nprovider sample מזהה לקוח=32257537:", { asm: sampleProv["אסמכתא"], variant: String(sampleProv["וריאנט"]).slice(0, 50) });
  const ezMatch = ezNof.filter((e) => String(e.CouponNo).includes("32257537") || String(e.מזהה) === "32257537");
  console.log("ez rows related:", ezMatch.map((e) => ({ CouponNo: e.CouponNo, מזהה: e.מזהה, desc: e.CouponDesc })));
}
