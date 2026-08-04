import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assertMetaTemplateCanonicalOrThrow,
  botScriptTextToMetaTemplateBody,
  checkMetaTemplateCanonicalDrift,
  extractTimeTokens,
  isMetaTemplateDriftError,
  META_TEMPLATE_CANONICAL_WARN_ONLY,
  normalizeTemplateBodyForCompare,
  templateBodiesMatch,
  templateTimesMatch,
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

Deno.test("META_TEMPLATE_CANONICAL_WARN_ONLY covers night_before, not suite_welcome_morning", () => {
  assertEquals(META_TEMPLATE_CANONICAL_WARN_ONLY.has("night_before_suites"), true);
  assertEquals(META_TEMPLATE_CANONICAL_WARN_ONLY.has("night_before_suites_shabbat"), true);
  assertEquals(META_TEMPLATE_CANONICAL_WARN_ONLY.has("suite_welcome_morning"), false);
});

Deno.test("extractTimeTokens finds and zero-pads HH:MM tokens", () => {
  assertEquals(extractTimeTokens("כניסה מ-9:00 וקבלה מ-15:00"), ["09:00", "15:00"]);
  assertEquals(extractTimeTokens("אין שעות כאן"), []);
});

Deno.test("templateTimesMatch: same times, different wording → match", () => {
  const canonical = "כניסה למתחם החל מהשעה - 12:00\nוקבלת החדרים החל משעה - 15:00";
  const rewordedSameTimes =
    "שלום {{1}}! מתרגשים לקבל אתכם 🌴\nהכניסה לריזורט מהשעה 12:00, וקבלת הסוויטות מהשעה 15:00. נתראה!";
  assertEquals(templateTimesMatch(canonical, rewordedSameTimes), true);
});

Deno.test("templateTimesMatch: different times → no match", () => {
  const canonical = "כניסה למתחם החל מהשעה - 12:00\nוקבלת החדרים החל משעה - 15:00";
  const staleTimes = "כניסה למתחם החל מהשעה - 09:00\nוקבלת החדרים החל משעה - 15:00";
  assertEquals(templateTimesMatch(canonical, staleTimes), false);
});

Deno.test("night_before_suites: different wording, same times → not blocked", async () => {
  const supabase = {} as never; // static snapshot short-circuits before any bot_scripts lookup
  const origFetch = globalThis.fetch;
  Deno.env.set("META_WHATSAPP_TOKEN", "test-token");
  Deno.env.set("META_BUSINESS_ACCOUNT_ID", "waba-test");
  clearMetaTemplateBodyCacheForTests();

  const liveRewordedSameTimes =
    "שלום {{1}}! מתרגשים לקבל אתכם 🌴\n" +
    "הכניסה לריזורט דרך שער הסוויטות — נא לצלצל בפעמון בהגעה.\n" +
    "כניסה למתחם מהשעה 12:00, קבלת הסוויטות מהשעה 15:00.\n" +
    "מחכים לכם!";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      data: [{ name: "night_before_suites", components: [{ type: "BODY", text: liveRewordedSameTimes }] }],
    }));

  try {
    const result = await checkMetaTemplateCanonicalDrift(supabase, "night_before_suites");
    assertEquals(result.ok, true);
    // Must resolve (not throw/reject) despite the wording being nothing like ACC's snapshot.
    await assertMetaTemplateCanonicalOrThrow(supabase, "night_before_suites");
  } finally {
    globalThis.fetch = origFetch;
    clearMetaTemplateBodyCacheForTests();
  }
});

Deno.test("night_before_suites: even a real time drift never blocks the send (warn only)", async () => {
  const supabase = {} as never;
  const origFetch = globalThis.fetch;
  const origWarn = console.warn;
  let warnedWith = "";
  console.warn = (...args: unknown[]) => { warnedWith = args.map(String).join(" "); };
  Deno.env.set("META_WHATSAPP_TOKEN", "test-token");
  Deno.env.set("META_BUSINESS_ACCOUNT_ID", "waba-test");
  clearMetaTemplateBodyCacheForTests();

  const liveStaleTimes =
    "היי {{1}} מה שלומכם?🌸\n" +
    "מצפים להגעה שלכם לדרים איילנד.\n" +
    "כניסה למתחם החל מהשעה - 09:00\n" +
    "וקבלת החדרים החל משעה - 15:00\n" +
    "מחכים לכם\n" +
    "צוות דרים איילנד🌸";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      data: [{ name: "night_before_suites", components: [{ type: "BODY", text: liveStaleTimes }] }],
    }));

  try {
    const result = await checkMetaTemplateCanonicalDrift(supabase, "night_before_suites");
    assertEquals(result.ok, false); // drift is still detected...
    // ...but the assert helper must resolve, never throw, for a warn-only template.
    await assertMetaTemplateCanonicalOrThrow(supabase, "night_before_suites");
    assertEquals(warnedWith.includes("template_body_drift"), true);
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
    clearMetaTemplateBodyCacheForTests();
  }
});
