import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolvePositiveFeedbackReplyBody } from "./postSurveyPositiveFeedback.ts";

Deno.test("resolvePositiveFeedbackReplyBody — replaces GOOGLE_REVIEW_URL placeholder", async () => {
  const prev = Deno.env.get("GOOGLE_REVIEW_URL");
  Deno.env.set("GOOGLE_REVIEW_URL", "https://g.page/test-review");
  try {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                message_text: "תודה! {{GOOGLE_REVIEW_URL}}",
              },
            }),
          }),
        }),
      }),
    };
    const body = await resolvePositiveFeedbackReplyBody(supabase as never);
    assertEquals(body, "תודה! https://g.page/test-review");
  } finally {
    if (prev === undefined) Deno.env.delete("GOOGLE_REVIEW_URL");
    else Deno.env.set("GOOGLE_REVIEW_URL", prev);
  }
});
