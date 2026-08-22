import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  DEFAULT_GOOGLE_REVIEW_URL,
  resolveGoogleReviewUrl,
} from "./googleReviewUrl.ts";

Deno.test("resolveGoogleReviewUrl — empty / homepage / waze fall back to write-review", () => {
  assertEquals(resolveGoogleReviewUrl(""), DEFAULT_GOOGLE_REVIEW_URL);
  assertEquals(resolveGoogleReviewUrl(null), DEFAULT_GOOGLE_REVIEW_URL);
  assertEquals(resolveGoogleReviewUrl("dream-island.co.il"), DEFAULT_GOOGLE_REVIEW_URL);
  assertEquals(resolveGoogleReviewUrl("https://www.dream-island.co.il/"), DEFAULT_GOOGLE_REVIEW_URL);
  assertEquals(resolveGoogleReviewUrl("https://waze.com/ul/hsv8sj2bbc"), DEFAULT_GOOGLE_REVIEW_URL);
  assertEquals(resolveGoogleReviewUrl("https://www.waze.com/ul/hsv8sj2bbc"), DEFAULT_GOOGLE_REVIEW_URL);
});

Deno.test("resolveGoogleReviewUrl — keeps a real Google review URL", () => {
  const ok = "https://search.google.com/local/writereview?placeid=ChIJzaIHH_ybAhURhKnG4XXJDGo";
  assertEquals(resolveGoogleReviewUrl(ok), ok);
  assertEquals(
    resolveGoogleReviewUrl("https://g.page/r/custom-review"),
    "https://g.page/r/custom-review",
  );
});
