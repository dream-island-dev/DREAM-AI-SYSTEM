/** Dry-run: parse Operations .eml + match against guest cache JSON from stdin or file. */
import { readFileSync } from "node:fs";
import {
  classifyEzgoMailContent,
  defaultDoc1ParseOpts,
  parseDoc1FromClassification,
  buildDoc1EnrichmentPatch,
  type Doc1Record,
} from "../supabase/functions/_shared/ezgoDoc1Parser.ts";
import {
  findGuestForDoc1Enrichment,
  type GuestRow,
} from "../supabase/functions/_shared/ezgoMailMatch.ts";

function extractHtmlFromEml(emlText: string): string | null {
  const raw = String(emlText || "");
  const boundary = raw.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  const chunks = boundary
    ? raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))
    : [raw];

  const partBody = (part: string): string => {
    const split = part.split(/\r?\n\r?\n/);
    if (split.length < 2) return "";
    let body = split.slice(1).join("\n\n");
    body = body.replace(/\r?\n--[^\r\n]+[\s\S]*$/, "").trim();
    const cte = part.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1]?.toLowerCase();
    if (cte === "quoted-printable") {
      const softBreaks = body.replace(/=\r?\n/g, "");
      const bytes: number[] = [];
      for (let i = 0; i < softBreaks.length; i++) {
        if (softBreaks[i] === "=" && i + 2 < softBreaks.length) {
          const hex = softBreaks.slice(i + 1, i + 3);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            bytes.push(parseInt(hex, 16));
            i += 2;
            continue;
          }
        }
        bytes.push(softBreaks.charCodeAt(i) & 0xff);
      }
      return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    }
    if (cte === "base64") {
      try {
        const bin = atob(body.replace(/\s/g, ""));
        const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder("utf-8").decode(arr);
      } catch {
        return "";
      }
    }
    return body;
  };

  for (const part of chunks) {
    if (!/content-type:\s*text\/html/i.test(part)) continue;
    const body = partBody(part);
    if (/<table[\s>]/i.test(body)) return body;
  }
  return null;
}

const emlPath = Deno.args[0] ||
  "c:/Users/mikek/Downloads/Dream Island - Spa & Health Resort _ Operations.eml";
const guestsPath = Deno.args[1] || "";

const eml = readFileSync(emlPath, "utf8");
const html = extractHtmlFromEml(eml);
if (!html) {
  console.error("FAIL: no HTML table in EML");
  Deno.exit(1);
}
console.log("html_len:", html.length);
console.log("has_table:", /<table[\s>]/i.test(html));

const classified = classifyEzgoMailContent(html, "");
const classifiedForParse = classified;
console.log("classify:", classified.reportType);

const records = parseDoc1FromClassification(classifiedForParse, defaultDoc1ParseOpts(true));
const reportDate = records.find((r) => r.arrival_date)?.arrival_date ?? null;
console.log("report_date:", reportDate);
console.log("row_count:", records.length);

let guestCache: GuestRow[] = [];
if (guestsPath) {
  const parsed = JSON.parse(readFileSync(guestsPath, "utf8").replace(/^\uFEFF/, ""));
  guestCache = (Array.isArray(parsed) ? parsed : parsed.rows ?? []) as GuestRow[];
  console.log("guest_cache:", guestCache.length);
}

type RowReport = {
  order: string | null;
  name: string | null;
  phone: string | null;
  spa_time: string | null;
  treatments: number;
  meal: string | null;
  match: string;
  patch_keys: string[];
};

const rows: RowReport[] = [];
let orderMatch = 0;
let phoneMatch = 0;
let noMatch = 0;
let enrichable = 0;

for (const rec of records) {
  const guest = guestCache.length ? findGuestForDoc1Enrichment(guestCache, rec) : null;
  let match = "—";
  const patchKeys: string[] = [];
  if (guest) {
    const byOrder = rec.order_number && guest.order_number === rec.order_number;
    match = byOrder ? `order → #${guest.id} ${guest.name}` : `phone/stay → #${guest.id} ${guest.name}`;
    if (byOrder) orderMatch++;
    else phoneMatch++;
    const patch = buildDoc1EnrichmentPatch(rec, guest);
    patchKeys.push(...Object.keys(patch));
    if (patchKeys.length) enrichable++;
  } else if (guestCache.length) {
    match = "no_match";
    noMatch++;
  }

  rows.push({
    order: rec.order_number,
    name: rec.guest_name,
    phone: rec.phone,
    spa_time: rec.spa_time,
    treatments: rec.treatment_count,
    meal: rec.meal_location,
    match,
    patch_keys: patchKeys,
  });
}

console.log("\n--- SUMMARY ---");
if (guestCache.length) {
  console.log(`order_match: ${orderMatch}`);
  console.log(`phone/stay_match: ${phoneMatch}`);
  console.log(`no_match: ${noMatch}`);
  console.log(`enrichable (has patch): ${enrichable}`);
}

console.log("\n--- ROWS ---");
for (const r of rows) {
  const spa = r.spa_time ? ` spa=${r.spa_time}` : "";
  const tr = r.treatments ? ` tx=${r.treatments}` : "";
  const meal = r.meal ? ` meal=${r.meal}` : "";
  const patch = r.patch_keys.length ? ` patch=[${r.patch_keys.join(",")}]` : "";
  console.log(
    `${r.order ?? "?"} | ${r.name ?? "?"} | ${r.phone ?? "?"}${spa}${tr}${meal} | ${r.match}${patch}`,
  );
}
