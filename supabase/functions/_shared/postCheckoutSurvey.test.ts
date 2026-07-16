import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { DEFAULT_POST_CHECKOUT_SURVEY_DELAY_MINUTES } from "./postCheckoutSurvey.ts";

Deno.test("postCheckoutSurvey: default delay is 15 minutes", () => {
  assertEquals(DEFAULT_POST_CHECKOUT_SURVEY_DELAY_MINUTES, 15);
});
