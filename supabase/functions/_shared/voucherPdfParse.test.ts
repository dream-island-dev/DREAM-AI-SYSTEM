import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseHeverPolicePdfText } from "./voucherPdfParse.ts";

const SAMPLE_PDF_TEXT = `
7018019/07/26 00:09 11210336455.001455.00שוטריםתיירות
1012319/07/26 10:23 121342581544.0021,088.00חברתיירות
3478119/07/26 00:20 121892214780.001780.00חברתיירות
`;

Deno.test("parseHeverPolicePdfText — extracts voucher, amount, org", () => {
  const rows = parseHeverPolicePdfText(SAMPLE_PDF_TEXT);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].voucher_number, "70180");
  assertEquals(rows[0].amount, 455);
  assertEquals(rows[0].org, "שוטרים");
  assertEquals(rows[1].voucher_number, "10123");
  assertEquals(rows[1].org, "חבר");
  assertEquals(rows[2].voucher_number, "34781");
});
