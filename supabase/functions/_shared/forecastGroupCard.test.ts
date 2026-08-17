import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReceptionGroupCard } from "./forecastGroupCard.ts";

const CARD = `
קבלת הקבוצה מהקבלה

* בנק לאומי- הנהלה ראשית *
דלאקס 45 דק וצהריים
כמות: 7
09:00 הגעה לדרים
טיפול ספא 45
התנהלות כבודדים

*אף מרימים*
נטע 0523434515
6 דלאקס 30 וצהריים
1 קלאסיק + 30 דק
כמות: 7
09:00 הגעה לדרים
14:00-15:30 טיפול ספא 30 דק
15:30 ארוחת צהריים תפריט ריזורט

*שטראוס גרופ*
גלית 0545772245
קלאסיק צהריים
כמות: 9
09:00 הגעה לדרים
17:00 ארוחת צהריים תפריט ריזורט
`;

Deno.test("reception group card fills three named rows like the Excel", () => {
  const rows = parseReceptionGroupCard(CARD);
  assertEquals(rows.length, 3);
  assertEquals(rows.map((g) => g.qty), [7, 7, 9]);
  assertEquals(rows.reduce((s, g) => s + g.qty, 0), 23);
  assertEquals(rows[0].name.includes("בנק לאומי"), true);
  assertEquals(rows[0].meals, "התנהלות כבודדים");
  assertEquals(rows[0].entry, "קבלה");
  assertEquals(rows[0].arrival, "09:00");
  assertEquals(rows[1].name.includes("מרימים"), true);
  assertEquals(rows[1].meals, "15:30");
  assertEquals(rows[2].name.includes("שטראוס"), true);
  assertEquals(rows[2].meals, "17:00");
});
