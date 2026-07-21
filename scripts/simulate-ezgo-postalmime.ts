/** Dry-run: parse a raw .eml via postal-mime (same lib as production ezgoMailImap.ts),
 * then run the real Doc1 classifier/parser on the extracted body. */
import { readFileSync } from "node:fs";
import * as postalMimeMod from "https://esm.sh/postal-mime@2.4.3";
import {
  classifyEzgoMailContent,
  defaultDoc1ParseOpts,
  parseDoc1FromClassification,
  countDoc1RecordsMissingPhone,
} from "../supabase/functions/_shared/ezgoDoc1Parser.ts";

const emlPath = Deno.args[0];
if (!emlPath) {
  console.error("usage: deno run --allow-read simulate-ezgo-postalmime.ts <path.eml>");
  Deno.exit(1);
}

const raw = readFileSync(emlPath);
const PostalMime = (postalMimeMod as { default?: { parse: (s: Uint8Array) => Promise<any> } }).default ?? postalMimeMod;
const email = await (PostalMime as any).parse(raw);

console.log("from:", email.from?.address, email.from?.name);
console.log("subject:", email.subject);
console.log("html_len:", email.html?.length ?? 0);
console.log("text_len:", email.text?.length ?? 0);
console.log("attachments:", email.attachments?.map((a) => `${a.filename} (${a.mimeType}, ${a.content?.byteLength ?? 0}b)`));

const classified = classifyEzgoMailContent(email.html ?? "", email.text ?? "");
console.log("classify:", classified.reportType);

const records = parseDoc1FromClassification(classified, defaultDoc1ParseOpts(true));
console.log("row_count:", records.length);
console.log("missing_phone:", countDoc1RecordsMissingPhone(records));

console.log("\n--- FIRST 10 RECORDS ---");
for (const r of records.slice(0, 10)) {
  console.log(
    `${r.order_number ?? "?"} | ${r.guest_name ?? "?"} | ${r.phone ?? "?"} | spa=${r.spa_time ?? "-"} tx=${r.treatment_count} meal=${r.meal_location ?? "-"}`,
  );
}
