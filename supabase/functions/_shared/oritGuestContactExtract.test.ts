import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  extractGuestContactFromFormBody,
  resolveOritReplyEmail,
} from "./oritGuestContactExtract.ts";

const SAMPLE = `שם מלא: שרון טלפון: 0507579741 דוא&quot;ל: sharonozan@gmail.com תוכן ההודעה: שלום רב, אני מחפשת חוויה משפחתית`;

Deno.test("extractGuestContactFromFormBody — website lead form", () => {
  const c = extractGuestContactFromFormBody(SAMPLE);
  assertEquals(c.name, "שרון");
  assertEquals(c.phone, "+972507579741");
  assertEquals(c.email, "sharonozan@gmail.com");
});

Deno.test("resolveOritReplyEmail — prefers extracted guest email, blocks relay", () => {
  assertEquals(
    resolveOritReplyEmail("ads9@richkid.co.il", "sharonozan@gmail.com"),
    "sharonozan@gmail.com",
  );
  assertEquals(
    resolveOritReplyEmail("ads9@richkid.co.il", null),
    "",
  );
  assertEquals(
    resolveOritReplyEmail("guest@example.com", null),
    "guest@example.com",
  );
});
