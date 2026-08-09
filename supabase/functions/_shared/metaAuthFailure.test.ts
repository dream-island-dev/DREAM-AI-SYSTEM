import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isMetaAuthFailure } from "./metaAuthFailure.ts";

Deno.test("isMetaAuthFailure: detects real 2026-08-09 incident payloads", () => {
  assertEquals(
    isMetaAuthFailure(
      'meta_template_401: {"error":{"message":"Authentication Error","code":190,"type":"OAuthException","fbtrace_id":"AeyS6QuiFFG_WiirB8-JxPt"}}',
    ),
    true,
  );
  assertEquals(
    isMetaAuthFailure('meta_http_401: {"error":{"message":"Authentication Error","code":190}}'),
    true,
  );
});

Deno.test("isMetaAuthFailure: unrelated failures are not misclassified", () => {
  assertEquals(isMetaAuthFailure("whapi_rate_limited: קצב שליחה גלובלי"), false);
  assertEquals(
    isMetaAuthFailure('meta_template_400: {"error":{"code":132018,"message":"There’s an issue"}}'),
    false,
  );
  assertEquals(isMetaAuthFailure("template_body_drift: תבנית Meta לא תואמת"), false);
  assertEquals(isMetaAuthFailure(null), false);
  assertEquals(isMetaAuthFailure(undefined), false);
  assertEquals(isMetaAuthFailure(""), false);
});
