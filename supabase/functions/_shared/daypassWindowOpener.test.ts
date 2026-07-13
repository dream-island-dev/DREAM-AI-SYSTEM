import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DAYPASS_WINDOW_OPENER_CTA_HE,
  ensureDaypassWindowOpenerCta,
  isDaypassWindowOpenerMessage,
} from "./daypassWindowOpener.ts";

Deno.test("isDaypassWindowOpenerMessage: button label", () => {
  assertEquals(isDaypassWindowOpenerMessage(null, { buttonTitle: "מחכים לכם!" }), true);
});

Deno.test("isDaypassWindowOpenerMessage: typed phrase", () => {
  assertEquals(isDaypassWindowOpenerMessage("מחכים לכם!"), true);
  assertEquals(isDaypassWindowOpenerMessage("אנחנו בדרך"), true);
  assertEquals(isDaypassWindowOpenerMessage("כן, מגיעים!"), false);
});

Deno.test("ensureDaypassWindowOpenerCta: appends once", () => {
  const once = ensureDaypassWindowOpenerCta("שלום");
  assertEquals(once.includes(DAYPASS_WINDOW_OPENER_CTA_HE), true);
  const twice = ensureDaypassWindowOpenerCta(once);
  assertEquals(twice, once);
});
