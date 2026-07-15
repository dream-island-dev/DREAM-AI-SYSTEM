// deno test supabase/functions/_shared/taskCard.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildStaffDispatchedTaskCard } from "./taskCard.ts";

Deno.test("buildStaffDispatchedTaskCard — front_desk_voice and executive_voice source tags", () => {
  const desk = buildStaffDispatchedTaskCard("Suite 8", "Extra towels", null, "front_desk_voice");
  assertEquals(desk.includes("📍 Source: [FRONT DESK]"), true);

  const exec = buildStaffDispatchedTaskCard("Suite 3", "AC repair", null, "executive_voice");
  assertEquals(exec.includes("📍 Source: [EXEC VOICE]"), true);
});
