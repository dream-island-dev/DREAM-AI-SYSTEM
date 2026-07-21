import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  extractPhoneDigits,
  hasDialableGuestPhone,
  sanitizeMetaRecipientPhone,
} from "./metaPhone.ts";

Deno.test("hasDialableGuestPhone: null/empty/non-digit text → false", () => {
  assertEquals(hasDialableGuestPhone(null), false);
  assertEquals(hasDialableGuestPhone(""), false);
  assertEquals(hasDialableGuestPhone("   "), false);
  assertEquals(hasDialableGuestPhone("לא ידוע"), false);
});

Deno.test("hasDialableGuestPhone: Israeli mobile → true", () => {
  assertEquals(hasDialableGuestPhone("+972 50-123-4567"), true);
  assertEquals(extractPhoneDigits("0501234567"), "0501234567");
});

Deno.test("sanitizeMetaRecipientPhone: empty throws invalid_meta_recipient_phone", () => {
  assertThrows(
    () => sanitizeMetaRecipientPhone(null),
    Error,
    "invalid_meta_recipient_phone: empty",
  );
});
