import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeGuestOutboundBody } from "./guestInboundBurst.ts";

Deno.test("normalizeGuestOutboundBody — strips WHAPI tag and collapses whitespace", () => {
  const body = "יכולה לשלוח לכם יין ב-100 שח תרצו?";
  assertEquals(
    normalizeGuestOutboundBody(`[WHAPI]\n${body}`),
    body,
  );
  assertEquals(
    normalizeGuestOutboundBody(`  ${body}  `),
    body,
  );
});
