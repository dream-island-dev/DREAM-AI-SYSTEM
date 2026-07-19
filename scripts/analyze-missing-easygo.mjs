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
const cno = hdr.indexOf("CouponNo");
const mezahe = hdr.lastIndexOf("מזהה");
const desc = hdr.indexOf("CouponDesc");

const ezNof = [];
for (const line of lines.slice(1)) {
  const v = parseCsvLine(line);
  if (!String(v[ci]).includes("נופשונית")) continue;
  ezNof.push({
    CouponNo: String(v[cno] || "").replace(/^0+/, ""),
    מזהה: String(v[mezahe] || "").replace(/^0+/, ""),
    CouponDesc: v[desc],
  });
}

const prov = XLSX.readFile("c:/Users/mikek/Downloads/נופשונית (1).xlsx");
const pr = XLSX.utils.sheet_to_json(prov.Sheets[prov.SheetNames[0]], { defval: "" });

const ezCoupon = new Set(ezNof.map((e) => e.CouponNo).filter(Boolean));
const ezMezahe = new Set(ezNof.map((e) => e.מזהה).filter(Boolean));

let missCoupon = 0, missMezahe = 0, hitCoupon = 0, hitMezahe = 0;
const missingSamples = [];

for (const r of pr) {
  const id = String(r["מזהה לקוח"] || "").replace(/^0+/, "");
  if (!id) continue;
  const inC = ezCoupon.has(id);
  const inM = ezMezahe.has(id);
  if (inC) hitCoupon++;
  else missCoupon++;
  if (inM) hitMezahe++;
  else missMezahe++;
  if (!inC && !inM && missingSamples.length < 15) {
    missingSamples.push({ id, variant: String(r["וריאנט"] || "").slice(0, 50), asm: r["אסמכתא"] });
  }
}

console.log("provider rows", pr.length);
console.log("ez nof rows", ezNof.length, "unique CouponNo", ezCoupon.size, "unique מזהה", ezMezahe.size);
console.log("provider מזהה לקוח in EZGO CouponNo:", hitCoupon, "missing:", missCoupon);
console.log("provider מזהה לקוח in EZGO מזהה:", hitMezahe, "missing:", missMezahe);
console.log("\nmissing both (sample):", missingSamples);

// Simulate DB reconciliation: each easygo id consumed once
const matchedEz = new Set();
let matched = 0, pkgMismatch = 0, duplicate = 0, missingEz = 0;

function pkgMatch(a, b) {
  const na = String(a).toLowerCase();
  const nb = String(b).toLowerCase();
  if (na.includes("classic") && nb.includes("קלאס")) return true;
  if (na.includes("deluxe") && (nb.includes("דלקס") || nb.includes("דלאקס"))) return true;
  return na.includes(nb) || nb.includes(na);
}

for (const r of pr) {
  const pid = String(r["מזהה לקוח"] || "").replace(/^0+/, "");
  const candidates = ezNof.filter((e) =>
    !matchedEz.has(e.CouponNo) && (e.CouponNo === pid || e.מזהה === pid)
  );
  if (!candidates.length) {
    missingEz++;
    continue;
  }
  if (candidates.length > 1) { duplicate++; matchedEz.add(candidates[0].CouponNo); continue; }
  const ez = candidates[0];
  matchedEz.add(ez.CouponNo);
  if (r["וריאנט"] && ez.CouponDesc && !pkgMatch(r["וריאנט"], ez.CouponDesc)) pkgMismatch++;
  else matched++;
}

const missingProv = ezNof.filter((e) => !matchedEz.has(e.CouponNo)).length;
console.log("\nSimulated one-to-one reconciliation:");
console.log({ matched, pkgMismatch, duplicate, missing_in_easygo: missingEz, missing_in_provider: missingProv });
