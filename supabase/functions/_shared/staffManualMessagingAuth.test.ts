import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canUseManualWhatsappTrigger,
  isRestaurantKioskStaff,
} from "./staffManualMessagingAuth.ts";

Deno.test("restaurant role is kiosk staff", () => {
  assertEquals(isRestaurantKioskStaff({ role: "restaurant", status: "active" }), true);
});

Deno.test("staff + restaurant_access is kiosk staff", () => {
  assertEquals(
    isRestaurantKioskStaff({ role: "staff", restaurant_access: true, status: "active" }),
    true,
  );
});

Deno.test("manager with restaurant_access is not kiosk staff", () => {
  assertEquals(
    isRestaurantKioskStaff({ role: "manager", restaurant_access: true, status: "active" }),
    false,
  );
});

Deno.test("restaurant kiosk may only inbox_reply", () => {
  const p = { role: "restaurant", status: "active" };
  assertEquals(canUseManualWhatsappTrigger("inbox_reply", p), true);
  assertEquals(canUseManualWhatsappTrigger("broadcast", p), false);
  assertEquals(canUseManualWhatsappTrigger("manual_script", p), false);
});

Deno.test("cleaner blocked from manual triggers", () => {
  assertEquals(canUseManualWhatsappTrigger("inbox_reply", { role: "cleaner", status: "active" }), false);
});

Deno.test("receptionist may broadcast", () => {
  assertEquals(canUseManualWhatsappTrigger("broadcast", { role: "receptionist", status: "active" }), true);
});
