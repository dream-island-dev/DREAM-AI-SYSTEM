// Classify EZGO Operations (Doc1 HTML) extras into forecast packages.
// Heads = unique "N - כניסה" after collapsing EZGO's duplicated voucher dump.
// Evening occupancy copies meals "כמות: N" (what reception fills) — couple
// vouchers still use כניסה for morning because כמות is packages not people.

export type OpsDayPart = "morning" | "evening" | "group" | "suite" | "skip";

export type OpsPackageRow = {
  orderNumber: string;
  extras: string;
  board: string;
  meals: string;
  guests: number;
  dayPart: OpsDayPart;
  bucket: string;
  label: string;
  lunch: boolean;
  dinner: boolean;
};

function stripTags(html: string): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOpsTableRows(html: string): Array<{
  orderNumber: string;
  extras: string;
  board: string;
  meals: string;
}> {
  const chunks = String(html || "").split(/<TR>/i);
  const out: Array<{ orderNumber: string; extras: string; board: string; meals: string }> = [];
  const tdRe = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
  for (const chunk of chunks) {
    if (!/<TD/i.test(chunk)) continue;
    const tds: string[] = [];
    tdRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tdRe.exec(chunk))) tds.push(m[1]);
    if (tds.length < 2) continue;
    const orderPlain = stripTags(tds[0]);
    const orderNumber = orderPlain.match(/(\d+):/)?.[1] ?? "";
    if (!orderNumber) continue;
    out.push({
      orderNumber,
      extras: stripTags(tds[1] ?? ""),
      board: stripTags(tds[2] ?? ""),
      meals: stripTags(tds[3] ?? ""),
    });
  }
  return out;
}

export function extraItemLines(extras: string): string[] {
  return String(extras || "")
    .split(/(?=\d+\s*-)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** EZGO often pastes the same voucher block 2–14 times in one extras cell. */
export function collapseExactTiling(lines: string[]): string[] {
  const n = lines.length;
  if (n < 2) return lines;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    if (n % k !== 0) continue;
    const unit = lines.slice(0, k);
    let tiles = true;
    for (let i = 0; i < n; i += k) {
      const chunk = lines.slice(i, i + k);
      if (chunk.join("\0") !== unit.join("\0")) {
        tiles = false;
        break;
      }
    }
    if (tiles) return unit;
  }
  return lines;
}

function knisaSum(lines: string[]): number {
  let n = 0;
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*-\s*כניסה/);
    if (m) n += parseInt(m[1], 10);
  }
  return n;
}

function firstMealsQty(meals: string): number {
  const m = String(meals || "").match(/כמות:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function opsGuestQty(extras: string, meals: string, dayPart?: OpsDayPart): number {
  const collapsed = collapseExactTiling(extraItemLines(extras));
  const knisa = knisaSum(collapsed);
  const mealsQty = firstMealsQty(meals);
  if (dayPart === "evening" && mealsQty > 0) return mealsQty;
  if (knisa > 0) return knisa;
  if (mealsQty > 0) return mealsQty;
  const fromExtras = extras.match(/^(\d+)\s*-/);
  if (fromExtras) return Math.max(1, parseInt(fromExtras[1], 10));
  return 1;
}

function isEveningText(extras: string, meals: string): boolean {
  if (/ארוחת ערב/.test(meals)) return true;
  if (/ערב/.test(extras)) return true;
  if (/מ-?\s*15:00/.test(extras) || /מ-?\s*16:00/.test(extras)) return true;
  return false;
}

function morningBucket(extras: string): { bucket: string; label: string } {
  const ex = extras;
  if (/דלאקס|דלוקס|Deluxe/i.test(ex) && /45/.test(ex) && /צהרים|צהריים/.test(ex)) {
    return { bucket: "deluxe_45_lunch", label: "דלאקס 45 וצהריים" };
  }
  if (/דלאקס|דלוקס|Deluxe/i.test(ex) && /30/.test(ex) && /צהרים|צהריים/.test(ex)) {
    return { bucket: "deluxe_30_lunch", label: "דלאקס 30 וצהריים" };
  }
  if (/דלאקס|דלוקס|Deluxe/i.test(ex) && /45/.test(ex)) {
    return { bucket: "deluxe_45", label: "דלאקס 45" };
  }
  if (/קלאסיק|classic more/i.test(ex) && /45/.test(ex) && /צהרים|צהריים/.test(ex)) {
    return { bucket: "classic_45_lunch", label: "קלאסיק 45 וצהריים" };
  }
  if (/קלאסיק|classic more/i.test(ex) && /צהרים|צהריים/.test(ex)) {
    return { bucket: "classic_lunch", label: "קלאסיק וצהריים" };
  }
  if (/קלאסיק/.test(ex) && /45/.test(ex)) {
    return { bucket: "classic_45", label: "קלאסיק 45" };
  }
  if (/קלאסיק/.test(ex)) {
    return { bucket: "classic", label: "קלאסיק" };
  }
  if (/טיפול זוגי|מילואים/.test(ex)) {
    return { bucket: "treatment_other", label: "חבילת טיפול זוגי / מילואים" };
  }
  if (/צהרים|צהריים/.test(ex)) {
    return { bucket: "lunch_other", label: "צהריים (חבילה אחרת)" };
  }
  if (/טיפול/.test(ex)) {
    return { bucket: "treatment_other", label: "טיפול (ללא שם חבילה)" };
  }
  if (!ex.trim()) {
    return { bucket: "empty", label: "בלי תוספות" };
  }
  return { bucket: "other", label: "אחר" };
}

function eveningBucket(extras: string): { bucket: string; label: string } {
  if ((/דלאקס|דלוקס|דלקס|Deluxe/i.test(extras)) && /16:00/.test(extras)) {
    return { bucket: "deluxe_16", label: "דלאקס ערב מ-16:00" };
  }
  if ((/דלאקס|דלוקס|דלקס|Deluxe/i.test(extras)) && /15:00/.test(extras)) {
    return { bucket: "deluxe_15", label: "דלאקס ערב מ-15:00" };
  }
  if (/קלאסיק/.test(extras) && /16:00/.test(extras)) {
    return { bucket: "classic_16", label: "קלאסיק מ-16:00" };
  }
  if (/קלאסיק/.test(extras) && /15:00/.test(extras)) {
    return { bucket: "classic_15", label: "קלאסיק מ-15:00" };
  }
  if (/קלאסיק/.test(extras) && /ערב/.test(extras)) {
    return { bucket: "classic_dinner", label: "קלאסיק עם א.ערב" };
  }
  return { bucket: "evening_other", label: "חבילת ערב (אחר)" };
}

function isOvernightBoard(board: string): boolean {
  return /\b(BB|HB|FB)\b/i.test(board);
}

export function classifyOpsRow(
  row: { orderNumber: string; extras: string; board: string; meals: string },
  suiteOrderNumbers: Set<string>,
): OpsPackageRow {
  const lunch = /צהרים|צהריים/.test(row.extras) || /צהרים|צהריים/.test(row.meals);
  const dinner = /ערב/.test(row.extras) || /ארוחת ערב/.test(row.meals);
  if (isOvernightBoard(row.board) || suiteOrderNumbers.has(row.orderNumber)) {
    const guests = opsGuestQty(row.extras, row.meals, "suite");
    return {
      ...row,
      guests,
      dayPart: "suite",
      bucket: "suite",
      label: "סוויטה (תפעול)",
      lunch,
      dinner,
    };
  }
  if (/לקבוצות|קבוצות בלבד/.test(row.extras)) {
    const guests = opsGuestQty(row.extras, row.meals, "group");
    return {
      ...row,
      guests,
      dayPart: "group",
      bucket: "group_ops",
      label: "קבוצה (שורת תפעול)",
      lunch,
      dinner,
    };
  }
  if (isEveningText(row.extras, row.meals)) {
    const guests = opsGuestQty(row.extras, row.meals, "evening");
    const b = eveningBucket(row.extras);
    return { ...row, guests, dayPart: "evening", ...b, lunch, dinner };
  }
  const guests = opsGuestQty(row.extras, row.meals, "morning");
  const b = morningBucket(row.extras);
  const dayPart: OpsDayPart = b.bucket === "empty" ? "skip" : "morning";
  return { ...row, guests, dayPart, ...b, lunch, dinner };
}

export function sumSpaTreatmentsFromExtras(extras: string): number {
  const lines = collapseExactTiling(extraItemLines(extras));
  let n = 0;
  for (const line of lines) {
    if (!/טיפול|ט\.\s*\d+|spa/i.test(line)) continue;
    if (/^\d+\s*-\s*כניסה/.test(line)) continue;
    const q = line.match(/^(\d+)\s*-/);
    if (q) n += parseInt(q[1], 10);
  }
  return n;
}

export function sumGroupSpaTreatments(rows: OpsPackageRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (row.dayPart !== "group") continue;
    n += sumSpaTreatmentsFromExtras(row.extras);
  }
  return n;
}
