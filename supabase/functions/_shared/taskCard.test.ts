// deno test supabase/functions/_shared/taskCard.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildStaffDispatchedTaskCard } from "./taskCard.ts";

Deno.test("buildStaffDispatchedTaskCard — compact layout + source tags", () => {
  const desk = buildStaffDispatchedTaskCard("ג׳ספר 5", "DENTAL KIT", null, "front_desk_voice");
  assertEquals(desk.includes("📌 Suite ג׳ספר 5"), true);
  assertEquals(desk.includes("[FRONT DESK]"), true);
  assertEquals(desk.includes("📍 Source:"), false);
  assertEquals(desk.includes("New Task Opened"), false);
  assertEquals(desk.endsWith("👉 Please react with 👍🏼 to complete this task."), true);

  const guestWa = buildStaffDispatchedTaskCard("ג׳ספר 5", "DENTAL KIT", null, "inbox_routed");
  assertEquals(guestWa.includes("[GUEST WA]"), true);

  const exec = buildStaffDispatchedTaskCard("Suite 3", "AC repair", null, "executive_voice");
  assertEquals(exec.includes("[EXEC VOICE]"), true);
});
