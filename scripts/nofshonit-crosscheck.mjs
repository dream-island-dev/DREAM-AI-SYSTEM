import fs from "fs";
import XLSX from "xlsx";

function parseCsvUtf8(path) {
  const s = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = s.split(/\r?\n/).filter(Boolean);
  const hdr = [];
  // proper CSV header parse
  function parseLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQ = !inQ;
        continue;
      }
      if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  const headerCells = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  // duplicate headers: keep last non-empty for lookup keys
  const colKeys = headerCells.map((h, i) => {
    const base = h || `col_${i}`;
    return headerCells.slice(0, i).filter((x) => x === h).length ? `${base}__${i}` : base;
  });
  return lines.slice(1).map((l) => {
    const v = parseLine(l);
    const o = {};
    colKeys.forEach((h, i) => {
      o[h] = (v[i] || "").replace(/^"|"$/g, "");
    });
    // EZGO export: real company name is the LAST "חברת שוברים" column
    const companyCols = colKeys.filter((k) => k.startsWith("חברת שוברים"));
    o["חברת שוברים"] = o[companyCols[companyCols.length - 1]] || "";
    const idCols = colKeys.filter((k) => k === "מזהה" || k.startsWith("מזהה__"));
    o["מזהה"] = o[idCols[idCols.length - 1]] || "";
    return o;
  });
}

const ezRows = parseCsvUtf8("c:/Users/mikek/Downloads/איזיגו.csv");
const idCol = "מזהה";
const companyCol = "חברת שוברים";
const nof = ezRows.filter((r) => String(r[companyCol] || "").includes("נופשונית"));
console.log("EZGO total", ezRows.length, "nofshonit", nof.length);
console.log("sample company", nof[0]?.[companyCol]?.slice?.(0, 50));

const prov = XLSX.readFile("c:/Users/mikek/Downloads/נופשונית (1).xlsx");
const pr = XLSX.utils.sheet_to_json(prov.Sheets[prov.SheetNames[0]], { defval: "" });
const provIds = new Set(pr.map((r) => String(r["מזהה לקוח"] || "").replace(/^0+/, "")));

const ids = ["203232623", "207031874", "322523226", "34252510"];
for (const id of ids) {
  const ez = nof.filter((r) => String(r[idCol] || "") === id || String(r.CouponNo || "") === id);
  const any = ezRows.filter((r) => JSON.stringify(r).includes(id));
  console.log("\n---", id, "---");
  console.log("in provider:", provIds.has(id));
  console.log("in nof filter:", ez.length > 0, "anywhere in csv:", any.length > 0);
}

const ezIds = [...new Set(nof.map((r) => String(r[idCol] || "").replace(/^0+/, "")).filter(Boolean))];
let match = 0;
const missing = [];
for (const id of ezIds) {
  if (provIds.has(id)) match++;
  else missing.push(id);
}
console.log("\nunique ez מזהה:", ezIds.length, "matched:", match, "missing:", missing.length);
console.log("missing sample:", missing.slice(0, 15));

// XLSX read of CSV (like production)
const csvBuf = fs.readFileSync("c:/Users/mikek/Downloads/איזיגו.csv");
const wb = XLSX.read(csvBuf, { type: "buffer", codepage: 65001 });
const xlsxRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
const xnof = xlsxRows.filter((r) => String(r["חברת שוברים"] || "").includes("נופשונית"));
console.log("\nXLSX CSV read: total", xlsxRows.length, "nof", xnof.length);
console.log("XLSX headers sample:", Object.keys(xlsxRows[0] || {}).slice(0, 8));

// Regex fallback — מזהה is last numeric field before trailing empty סוכן on EZGO rows
const rawLines = fs.readFileSync("c:/Users/mikek/Downloads/איזיגו.csv", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.includes("נופשונית"));
const ezIdSet = new Set();
for (const line of rawLines) {
  const m = line.match(/,"(\d{7,9})",""\s*$/);
  if (m) ezIdSet.add(m[1].replace(/^0+/, ""));
}
let match2 = 0;
const missing2 = [];
for (const id of ezIdSet) {
  if (provIds.has(id)) match2++;
  else missing2.push(id);
}
console.log("\nRegex cross-check: ez ids", ezIdSet.size, "matched", match2, "missing", missing2.length);
console.log("Screenshot ids in ez/prov:");
for (const id of ids) console.log(id, "ez", ezIdSet.has(id), "prov", provIds.has(id));
