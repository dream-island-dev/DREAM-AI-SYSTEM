import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { selectHousekeepingAckLines, warnHousekeepingProblemSignals } from "./housekeepingAckSelect.ts";

type Fake = { action: string; label: string };

const buildLine = (r: Fake): string | null => (r.label ? `[${r.action}] ${r.label}` : null);

Deno.test("selectHousekeepingAckLines: hkGroupReply=false — nothing passes, not even error/ambiguous", () => {
  const signals: Fake[] = [
    { action: "updated", label: "ok" },
    { action: "error", label: "boom" },
    { action: "skipped_no_suite", label: "unknown room" },
    { action: "ambiguous_guest", label: "several guests" },
    { action: "dedup", label: "dup" },
  ];
  assertEquals(selectHousekeepingAckLines(signals, buildLine, false), []);
});

Deno.test("selectHousekeepingAckLines: hkGroupReply=true — everything with a line passes", () => {
  const signals: Fake[] = [
    { action: "updated", label: "ok" },
    { action: "error", label: "boom" },
  ];
  assertEquals(
    selectHousekeepingAckLines(signals, buildLine, true),
    ["[updated] ok", "[error] boom"],
  );
});

Deno.test("selectHousekeepingAckLines: hkGroupReply=true — null-returning lines are still dropped", () => {
  const signals: Fake[] = [{ action: "error", label: "" }]; // buildLine returns null for empty label
  assertEquals(selectHousekeepingAckLines(signals, buildLine, true), []);
});

type FakeSignal = {
  action: string;
  roomNumber: number;
  roomId: string | null;
  guestName?: string | null;
  error?: string;
};

function withCapturedWarn(fn: () => void): string[] {
  const calls: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

Deno.test("warnHousekeepingProblemSignals: warns only for problem actions, never sends anything", () => {
  const signals: FakeSignal[] = [
    { action: "updated", roomNumber: 4, roomId: "ג׳ספר 4" },
    { action: "ambiguous_guest", roomNumber: 3, roomId: "ג׳ספר 3", guestName: "כמה אורחים" },
    { action: "error", roomNumber: 7, roomId: "רובי 7", error: "db timeout" },
    { action: "dedup", roomNumber: 4, roomId: "ג׳ספר 4" },
  ];
  const problemActions = new Set(["ambiguous_guest", "error", "skipped_no_suite", "no_guest"]);

  const calls = withCapturedWarn(() => {
    warnHousekeepingProblemSignals("check_out", signals, problemActions);
  });

  assertEquals(calls.length, 2);
  assertEquals(calls[0].includes("ambiguous_guest"), true);
  assertEquals(calls[0].includes("ג׳ספר 3"), true);
  assertEquals(calls[1].includes("error"), true);
  assertEquals(calls[1].includes("db timeout"), true);
});

Deno.test("warnHousekeepingProblemSignals: empty problem set warns for nothing", () => {
  const signals: FakeSignal[] = [{ action: "error", roomNumber: 7, roomId: "רובי 7" }];
  const calls = withCapturedWarn(() => {
    warnHousekeepingProblemSignals("ready", signals, new Set());
  });
  assertEquals(calls.length, 0);
});
