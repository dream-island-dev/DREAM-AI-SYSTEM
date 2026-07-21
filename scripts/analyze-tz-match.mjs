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
const ci = hdr.lastIndexOf("חברת שוברים");
const cols = {
  order: hdr.indexOf("מס. הזמנה"),
  CouponNo: hdr.indexOf("CouponNo"),
  מזהה: hdr.lastIndexOf("מזהה"),
  name: hdr.indexOf("שם לקוח"),
  desc: hdr.indexOf("CouponDesc"),
};

const ezNof = [];
for (const line of lines.slice(1)) {
  const v = parseCsvLine(line);
  if (!String(v[ci]).includes("נופשונית")) continue;
  ezNof.push({
    order: v[cols.order],
    CouponNo: String(v[cols.CouponNo] || "").replace(/\.+$/, "").replace(/^0+/, ""),
    מזהה: String(v[cols.מזהה] || "").replace(/^0+/, ""),
    name: v[cols.name],
    desc: v[cols.desc],
  });
}

const prov = XLSX.readFile("c:/Users/mikek/Downloads/נופשונית (1).xlsx");
const pr = XLSX.utils.sheet_to_json(prov.Sheets[prov.SheetNames[0]], { defval: "" });
const norm = (x) => String(x || "").replace(/^0+/, "");

const ezTz = new Set(ezNof.map((e) => e.מזהה).filter(Boolean));
const ezCoupon = new Set(ezNof.map((e) => e.CouponNo).filter(Boolean));

let hitTz = 0, hitCoupon = 0, hitNeither = 0;
for (const r of pr) {
  const pid = norm(r["מזהה לקוח"]);
  if (ezTz.has(pid)) hitTz++;
  else if (ezCoupon.has(pid)) hitCoupon++;
  else hitNeither++;
}

console.log("provider rows", pr.length);
console.log("ez unique תז", ezTz.size, "unique CouponNo", ezCoupon.size);
console.log("provider מזהה לקוח -> EZGO מזהה:", hitTz);
console.log("provider מזהה לקוח -> EZGO CouponNo:", hitCoupon);
console.log("neither:", hitNeither);

const byOrder = new Map();
for (const e of ezNof) {
  if (!byOrder.has(e.order)) byOrder.set(e.order, []);
  byOrder.get(e.order).push(e);
}
const multi = [...byOrder.entries()].filter(([, rows]) => new Set(rows.map((r) => r.מזהה)).size > 1);
console.log("orders with multiple תז:", multi.length);
if (multi[0]) console.log("example:", multi[0][0], multi[0][1].length, "rows");

// Simulate TZ-based reconciliation with package check
const matchedEzIds = new Set();
let matched = 0, pkgBad = 0, missEz = 0, missProv = 0;
function pkgOk(a, b) {
  const na = String(a).toLowerCase(), nb = String(b).toLowerCase();
  if ((/classic|קלאס/i.test(na) && /classic|קלאס/i.test(nb))) return true;
  if ((/deluxe|דלקס|דלאקס/i.test(na) && /deluxe|דלקס|דלאקס/i.test(nb))) return true;
  return na.includes(nb) || nb.includes(na);
}

for (const r of pr) {
  const pid = norm(r["מזהה לקוח"]);
  const candidates = ezNof.filter((e) => e.מזהה === pid);
  if (!candidates.length) { missEz++; continue; }
  const ez = candidates.find((e) => !matchedEzIds.has(e.CouponNo + e.מזהה)) || candidates[0];
  matchedEzIds.add(ez.CouponNo + ez.מזהה);
  if (r["וריאנט"] && ez.desc && !pkgOk(r["וריאנט"], ez.desc)) pkgBad++;
  else matched++;
}
for (const e of ezNof) {
  if (![...matchedEzIds].some((k) => k.endsWith(e.מזהה))) missProv++;
}
// Regex fallback for מזהה at line end (CSV quote issues)
const rawLines = fs.readFileSync("c:/Users/mikek/Downloads/איזיגו.csv", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.includes("נופשונית") && !l.startsWith('"RefType"'));
const tzFromRegex = new Map();
for (const line of rawLines) {
  const tzM = line.match(/,"(\d{7,9})",""\s*$/);
  const cM = line.match(/,"(\d{6,12})\.?","[^"]*","0"/);
  if (tzM && cM) {
    const tz = tzM[1].replace(/^0+/, "");
    const coupon = cM[1].replace(/^0+/, "").replace(/\.+$/, "");
    if (!tzFromRegex.has(tz)) tzFromRegex.set(tz, []);
    tzFromRegex.get(tz).push(coupon);
  }
}
console.log("\nRegex parsed: unique תז", tzFromRegex.size, "from", rawLines.length, "lines");
let ht2 = 0, hc2 = 0;
for (const r of pr) {
  const pid = norm(r["מזהה לקוח"]);
  if (tzFromRegex.has(pid)) ht2++;
  else {
    let inCoupon = false;
    for (const coupons of tzFromRegex.values()) if (coupons.includes(pid)) { inCoupon = true; break; }
    if (inCoupon) hc2++;
  }
}
console.log("provider id as תז (regex):", ht2, "as someone's CouponNo:", hc2);

// TZ-based match: provider מזהה לקוח should match EZGO מזהה when it's תז
// If provider stores CouponNo, match via coupon->tz lookup
let tzMatched = 0, tzMiss = 0;
for (const r of pr) {
  const pid = norm(r["מזהה לקוח"]);
  const hasTz = tzFromRegex.has(pid);
  let hasCoupon = false;
  for (const [tz, coupons] of tzFromRegex) {
    if (coupons.includes(pid)) { hasCoupon = true; break; }
  }
  if (hasTz || hasCoupon) tzMatched++;
  else tzMiss++;
}
console.log("provider rows linkable via תז graph:", tzMatched, "orphan:", tzMiss);

