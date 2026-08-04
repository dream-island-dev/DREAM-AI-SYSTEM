import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { selectHousekeepingAckLines } from "./housekeepingAckSelect.ts";

type Fake = { action: string; label: string };

const buildLine = (r: Fake): string | null => (r.label ? `[${r.action}] ${r.label}` : null);
const ALWAYS = new Set(["error", "skipped_no_suite"]);

Deno.test("selectHousekeepingAckLines: hkGroupReply=false — only always-visible actions pass", () => {
  const signals: Fake[] = [
    { action: "updated", label: "ok" },
    { action: "error", label: "boom" },
    { action: "skipped_no_suite", label: "unknown room" },
    { action: "dedup", label: "dup" },
  ];
  assertEquals(
    selectHousekeepingAckLines(signals, buildLine, ALWAYS, false),
    ["[error] boom", "[skipped_no_suite] unknown room"],
  );
});

Deno.test("selectHousekeepingAckLines: hkGroupReply=true — everything with a line passes", () => {
  const signals: Fake[] = [
    { action: "updated", label: "ok" },
    { action: "error", label: "boom" },
  ];
  assertEquals(
    selectHousekeepingAckLines(signals, buildLine, ALWAYS, true),
    ["[updated] ok", "[error] boom"],
  );
});

Deno.test("selectHousekeepingAckLines: null-returning lines are dropped even for always-visible actions", () => {
  const signals: Fake[] = [{ action: "error", label: "" }]; // buildLine returns null for empty label
  assertEquals(selectHousekeepingAckLines(signals, buildLine, ALWAYS, false), []);
});
