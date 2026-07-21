import { readFileSync } from "node:fs";
import { csvUtf8BytesToMatrix } from "../supabase/functions/_shared/voucherImport.ts";

const bytes = readFileSync("c:/Users/mikek/Downloads/איזיגו.csv");
const matrix = csvUtf8BytesToMatrix(bytes);
const hdr = matrix[0] as string[];
const companyCol = hdr.lastIndexOf("חברת שוברים");

for (let i = 1; i < matrix.length; i++) {
  const line = matrix[i] as string[];
  if (!String(line[companyCol] || "").includes("נופשונית")) continue;
  console.log("--- row", i, "len", line.length, "---");
  for (let c = 0; c < Math.min(line.length, hdr.length); c++) {
    const v = String(line[c] ?? "").trim();
    if (v) console.log(`  [${c}] ${hdr[c]}: ${v.slice(0, 40)}`);
  }
  break;
}
