// supabase/functions/_shared/guestFacilityReview.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifyFacilityReview,
  detectFacilityCategory,
  extractRatingFromText,
  normalizeFacilityReviewToolArgs,
} from "./guestFacilityReview.ts";

Deno.test("detectFacilityCategory — restaurant keywords", () => {
  assertEquals(detectFacilityCategory("המסעדה הייתה מעולה"), "restaurant");
  assertEquals(detectFacilityCategory("ארוחת בוקר בערמונים"), "restaurant");
});

Deno.test("classifyFacilityReview — positive restaurant", () => {
  const r = classifyFacilityReview("האוכל במסעדה היה מדהים, תודה!");
  assertEquals(r?.facility, "restaurant");
  assertEquals(r?.sentiment, "positive");
});

Deno.test("classifyFacilityReview — rejects plain FAQ", () => {
  assertEquals(classifyFacilityReview("מתי נפתחת המסעדה?"), null);
  assertEquals(classifyFacilityReview("איפה המסעדה?"), null);
});

Deno.test("classifyFacilityReview — rating extraction", () => {
  const r = classifyFacilityReview("המסעדה מקבלת ממני 9/10");
  assertEquals(r?.rating, 9);
  assertEquals(r?.sentiment, "positive");
});

Deno.test("classifyFacilityReview — spa negative", () => {
  const r = classifyFacilityReview("הטיפול בספא היה מאכזב");
  assertEquals(r?.facility, "spa");
  assertEquals(r?.sentiment, "negative");
});

Deno.test("classifyFacilityReview — massage typo + לא התרשמנו (spa negative)", () => {
  const t =
    "המקום מצויין מדהים יחסית למחיר לא התרשמנו מהמסטאג' היה פחות 45 דקות וגם יותר מדי עדין";
  const r = classifyFacilityReview(t);
  assertEquals(r?.facility, "spa");
  assertEquals(r?.sentiment, "negative");
});

Deno.test("extractRatingFromText — Hebrew words", () => {
  assertEquals(extractRatingFromText("אני נותן תשע למסעדה"), 9);
});

Deno.test("normalizeFacilityReviewToolArgs — valid", () => {
  const r = normalizeFacilityReviewToolArgs({
    facility: "restaurant",
    sentiment: "positive",
    rating: 8,
    summary: "הארוחה הייתה טעימה מאוד",
  });
  assertEquals(r?.facility, "restaurant");
  assertEquals(r?.rating, 8);
  assertEquals(r?.source, "bot_tool");
});

Deno.test("normalizeFacilityReviewToolArgs — rejects invalid facility", () => {
  assertEquals(normalizeFacilityReviewToolArgs({ facility: "kitchen", sentiment: "positive", summary: "x" }), null);
});
