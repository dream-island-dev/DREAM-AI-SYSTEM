import { DEFAULT_GOOGLE_REVIEW_URL, resolveGoogleReviewUrl } from "./googleReviewUrl";

test("Waze and homepage are not Google review links", () => {
  expect(resolveGoogleReviewUrl("https://waze.com/ul/hsv8sj2bbc")).toBe(DEFAULT_GOOGLE_REVIEW_URL);
  expect(resolveGoogleReviewUrl("dream-island.co.il")).toBe(DEFAULT_GOOGLE_REVIEW_URL);
});

test("keeps a Google write-review URL", () => {
  expect(resolveGoogleReviewUrl(DEFAULT_GOOGLE_REVIEW_URL)).toBe(DEFAULT_GOOGLE_REVIEW_URL);
});
