import { isApprovalGateStale, formatWaReadySource, ROOM_APPROVAL_GATE_STALE_MS } from "./roomApprovalGate";

describe("roomApprovalGate", () => {
  test("stale when Co after gate", () => {
    expect(isApprovalGateStale("2026-07-31T11:33:32.848Z", {
      checkoutAfterGateAt: "2026-08-02T06:55:15.185Z",
    })).toBe(true);
  });

  test("fresh gate within 24h", () => {
    const gateAt = new Date(Date.now() - 60_000).toISOString();
    expect(isApprovalGateStale(gateAt, {})).toBe(false);
  });

  test("stale after 24h", () => {
    const gateAt = new Date(Date.now() - ROOM_APPROVAL_GATE_STALE_MS - 1_000).toISOString();
    expect(isApprovalGateStale(gateAt, {})).toBe(true);
  });

  test("formatWaReadySource", () => {
    const s = formatWaReadySource({
      source_line: "9✅",
      from_name: "Adir hatmi",
      created_at: "2026-07-31T11:33:32.710Z",
    });
    expect(s).toContain("9✅");
    expect(s).toContain("Adir hatmi");
    expect(s).toContain("מזוהה מ-WA");
  });
});
