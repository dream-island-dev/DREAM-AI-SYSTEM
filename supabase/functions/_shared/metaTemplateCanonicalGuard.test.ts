import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assertMetaTemplateCanonicalOrThrow,
  botScriptTextToMetaTemplateBody,
  checkMetaTemplateCanonicalDrift,
  isMetaTemplateDriftError,
  normalizeTemplateBodyForCompare,
  templateBodiesMatch,
} from "./metaTemplateCanonicalGuard.ts";
import {
  clearMetaTemplateBodyCacheForTests,
  fetchLiveMetaTemplateBody,
} from "./metaTemplateLog.ts";

const CANONICAL_12 = `בוקר אור {{1}}! ✨ היום זה היום!
הריזורט מוכן וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.

כמה פרטים קטנים וחשובים לדרך:
🌸 כניסה למתחם החל מהשעה 12:00
🔑 קבלת הסוויטות החל מהשעה 15:00.

אם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️`;

const STALE_09 = `בוקר אור {{1}}! ✨ היום זה היום!
הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.

כמה פרטים קטנים וחשובים לדרך:
🌸 מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00 בבוקר.
🔑 קבלת החדרים והסוויטות היא החל מהשעה 15:00.

אם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️`;

Deno.test("botScriptTextToMetaTemplateBody maps GUEST_NAME → {{1}}", () => {
  assertEquals(botScriptTextToMetaTemplateBody("שלום {{GUEST_NAME}}!"), "שלום {{1}}!");
});

Deno.test("templateBodiesMatch ignores whitespace and placeholder style", () => {
  assertEquals(templateBodiesMatch("היי {{1}}", "היי  {{GUEST_NAME}}"), true);
  assertEquals(templateBodiesMatch(CANONICAL_12, CANONICAL_12.replace(/\n/g, "\n\n")), true);
  assertEquals(templateBodiesMatch(CANONICAL_12, STALE_09), false);
});

Deno.test("normalizeTemplateBodyForCompare collapses spaces", () => {
  assertEquals(normalizeTemplateBodyForCompare("a   b"), "a b");
});

Deno.test("checkMetaTemplateCanonicalDrift: ok when live matches bot_scripts", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              message_text: botScriptTextToMetaTemplateBody(CANONICAL_12)
                .replace("{{1}}", "{{GUEST_NAME}}"),
            },
          }),
        }),
      }),
    }),
  };

  const origFetch = globalThis.fetch;
  Deno.env.set("META_WHATSAPP_TOKEN", "test-token");
  Deno.env.set("META_BUSINESS_ACCOUNT_ID", "waba-test");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      data: [{ name: "suite_welcome_morning", components: [{ type: "BODY", text: CANONICAL_12 }] }],
    }));

  try {
    const result = await checkMetaTemplateCanonicalDrift(supabase as never, "suite_welcome_morning");
    if (!result.ok) throw new Error("expected ok");
    assertEquals(result.liveBody.includes("12:00"), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("checkMetaTemplateCanonicalDrift: blocks when Meta still has 09:00 pools", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { message_text: CANONICAL_12.replace(/\{\{1\}\}/g, "{{GUEST_NAME}}") },
          }),
        }),
      }),
    }),
  };

  const origFetch = globalThis.fetch;
  Deno.env.set("META_WHATSAPP_TOKEN", "test-token");
  Deno.env.set("META_BUSINESS_ACCOUNT_ID", "waba-test");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      data: [{ name: "suite_welcome_morning", components: [{ type: "BODY", text: STALE_09 }] }],
    }));

  try {
    const result = await checkMetaTemplateCanonicalDrift(supabase as never, "suite_welcome_morning");
    if (result.ok) throw new Error("expected drift");
    assertEquals(result.hebrewError.includes("template_body_drift"), true);
    assertEquals(isMetaTemplateDriftError(result.hebrewError), true);
    await assertRejects(
      () => assertMetaTemplateCanonicalOrThrow(supabase as never, "suite_welcome_morning"),
      Error,
      "template_body_drift",
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("checkMetaTemplateCanonicalDrift: pre-send guard bypasses a stale cached body", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { message_text: CANONICAL_12.replace(/\{\{1\}\}/g, "{{GUEST_NAME}}") },
          }),
        }),
      }),
    }),
  };

  const origFetch = globalThis.fetch;
  Deno.env.set("META_WHATSAPP_TOKEN", "test-token");
  Deno.env.set("META_BUSINESS_ACCOUNT_ID", "waba-test");
  clearMetaTemplateBodyCacheForTests();

  try {
    // Simulate an earlier preview/WYSIWYG call caching a body that happened to match
    // ACC at the time.
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        data: [{ name: "suite_welcome_morning", components: [{ type: "BODY", text: CANONICAL_12 }] }],
      }));
    const cachedBody = await fetchLiveMetaTemplateBody("suite_welcome_morning");
    assertEquals(cachedBody, CANONICAL_12);

    // Meta now actually serves the stale 09:00 copy (e.g. reverted/re-approved) — the
    // pre-send guard must catch this instead of trusting the now-outdated cache entry.
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        data: [{ name: "suite_welcome_morning", components: [{ type: "BODY", text: STALE_09 }] }],
      }));

    const result = await checkMetaTemplateCanonicalDrift(supabase as never, "suite_welcome_morning");
    if (result.ok) throw new Error("expected drift: guard used the stale cached body instead of a live fetch");
    assertEquals(result.liveBody, STALE_09);
    assertEquals(isMetaTemplateDriftError(result.hebrewError), true);

    await assertRejects(
      () => assertMetaTemplateCanonicalOrThrow(supabase as never, "suite_welcome_morning"),
      Error,
      "template_body_drift",
    );
  } finally {
    globalThis.fetch = origFetch;
    clearMetaTemplateBodyCacheForTests();
  }
});
