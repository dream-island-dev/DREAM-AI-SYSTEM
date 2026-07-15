// supabase/functions/_shared/handoffEscalation.test.ts
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PENDING_APPROVAL_AUTO_APPROVE_MINUTES,
  SOFT_HANDOFF_SLA_MINUTES,
  isUrgentOpsHumanRequestType,
  isSoftHandoffHumanRequestType,
  isOlderThanMinutes,
  pendingApprovalCutoffIso,
  softHandoffCutoffIso,
  dedupePhoneDigits,
  buildPendingAutoApproveManagerText,
  buildSoftHandoffManagerText,
} from "./handoffEscalation.ts";

Deno.test("isUrgentOpsHumanRequestType — only operational_request", () => {
  assertEquals(isUrgentOpsHumanRequestType("operational_request"), true);
  assertEquals(isUrgentOpsHumanRequestType("staff_handoff"), false);
  assertEquals(isUrgentOpsHumanRequestType("date_change"), false);
  assertEquals(isUrgentOpsHumanRequestType(null), false);
});

Deno.test("isSoftHandoffHumanRequestType — spa/date/finance soft; ops hard", () => {
  assertEquals(isSoftHandoffHumanRequestType("date_change"), true);
  assertEquals(isSoftHandoffHumanRequestType("financial_issue"), true);
  assertEquals(isSoftHandoffHumanRequestType("staff_handoff"), true);
  assertEquals(isSoftHandoffHumanRequestType("callback"), true);
  assertEquals(isSoftHandoffHumanRequestType(null), true); // unknown → soft
  assertEquals(isSoftHandoffHumanRequestType("operational_request"), false);
});

Deno.test("isOlderThanMinutes — boundary inclusive at exact threshold", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const sevenAgo = new Date(now.getTime() - 7 * 60_000).toISOString();
  const sixAgo = new Date(now.getTime() - 6 * 60_000).toISOString();
  assertEquals(isOlderThanMinutes(sevenAgo, 7, now), true);
  assertEquals(isOlderThanMinutes(sixAgo, 7, now), false);
});

Deno.test("cutoffs — pending 7min / soft 20min relative to now", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  assertEquals(
    pendingApprovalCutoffIso(PENDING_APPROVAL_AUTO_APPROVE_MINUTES, now),
    "2026-07-11T11:53:00.000Z",
  );
  assertEquals(
    softHandoffCutoffIso(SOFT_HANDOFF_SLA_MINUTES, now),
    "2026-07-11T11:40:00.000Z",
  );
});

Deno.test("dedupePhoneDigits — normalizes +972 / 0-prefix / strips dups", () => {
  assertEquals(
    dedupePhoneDigits(["+97250-542-1751", "0505421751", "972505421751", "", null, "bad"]),
    ["972505421751"],
  );
  assertEquals(
    dedupePhoneDigits(["972505421751", "972506842439", "972505421751"]),
    ["972505421751", "972506842439"],
  );
});

Deno.test("manager texts — hard mentions auto-dispatch; soft forbids ops card", () => {
  const hard = buildPendingAutoApproveManagerText({
    room: "אמטיסט 8",
    description: "בקשת מגבות לחדר",
    ageMinutes: 8,
    taskId: 42,
  });
  assert(hard.includes("נשלחה אוטומטית"));
  assert(hard.includes("משימה #42"));

  const soft = buildSoftHandoffManagerText({
    phone: "972501234567",
    requestType: "date_change",
    guestLabel: "ישראל ישראלי (אמטיסט 3)",
    ageMinutes: 22,
    preview: "אפשר צ'ק אאוט מאוחר?",
  });
  assert(soft.includes("אורח מחכה לתשובה"));
  assert(soft.includes("אל תפתח כרטיס תחזוקה"));
});
