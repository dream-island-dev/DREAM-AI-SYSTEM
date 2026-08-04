import { classifyRoomReadySendResult } from "./suiteRoomReady";

describe("classifyRoomReadySendResult", () => {
  test("hard error → error, never a success toast", () => {
    expect(classifyRoomReadySendResult({ data: null, error: { message: "boom" } }))
      .toEqual({ ok: false, kind: "error", reason: "boom" });
  });

  test("data.ok === false → error even without a transport error", () => {
    expect(classifyRoomReadySendResult({ data: { ok: false, error: "blocked_by_meta" }, error: null }))
      .toEqual({ ok: false, kind: "error", reason: "blocked_by_meta" });
  });

  test("timeout status → ok:true but kind:timeout, not a plain success", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true, status: "timeout" }, error: null }))
      .toEqual({ ok: true, kind: "timeout" });
  });

  test("duplicate_blocked → ok:true but kind:duplicate, never mislabeled as a fresh send", () => {
    expect(classifyRoomReadySendResult({
      data: { ok: true, skipped: true, status: "duplicate_blocked" }, error: null,
    })).toEqual({ ok: true, kind: "duplicate" });
  });

  test("generic skipped (no duplicate status) carries its reason through", () => {
    expect(classifyRoomReadySendResult({
      data: { ok: true, skipped: true, reason: "quiet_hours" }, error: null,
    })).toEqual({ ok: true, kind: "skipped", reason: "quiet_hours" });
  });

  test("plain success → kind:sent, simulation flag passed through", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true, simulation: true }, error: null }))
      .toEqual({ ok: true, kind: "sent", simulation: true });
  });

  test("plain success without simulation flag defaults to false", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true }, error: null }))
      .toEqual({ ok: true, kind: "sent", simulation: false });
  });
});
