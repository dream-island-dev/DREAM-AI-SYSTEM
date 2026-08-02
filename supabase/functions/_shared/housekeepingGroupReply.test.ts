import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isHousekeepingGroupReplyEnabled } from "./housekeepingWaParse.ts";

Deno.test("isHousekeepingGroupReplyEnabled: default off", () => {
  Deno.env.delete("HOUSEKEEPING_WA_GROUP_REPLY");
  assertEquals(isHousekeepingGroupReplyEnabled(), false);
});

Deno.test("isHousekeepingGroupReplyEnabled: explicit true", () => {
  Deno.env.set("HOUSEKEEPING_WA_GROUP_REPLY", "true");
  try {
    assertEquals(isHousekeepingGroupReplyEnabled(), true);
  } finally {
    Deno.env.delete("HOUSEKEEPING_WA_GROUP_REPLY");
  }
});
