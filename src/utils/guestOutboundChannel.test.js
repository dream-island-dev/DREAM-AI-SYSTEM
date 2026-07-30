import {
  inferGuestOutboundDefaults,
  canSendGuestFreeText,
  isMetaWindowOpenFromGuest,
} from "./guestOutboundChannel";

describe("inferGuestOutboundDefaults", () => {
  test("SOS forces meta and disables whapi", () => {
    const r = inferGuestOutboundDefaults(
      { room_type: "suite" },
      [{ inbox_channel: "whapi", created_at: "2026-07-30T10:00:00Z" }],
      true,
    );
    expect(r.defaultChannel).toBe("meta");
    expect(r.whapiDisabled).toBe(true);
  });

  test("suite with no history defaults to whapi", () => {
    const r = inferGuestOutboundDefaults({ room_type: "suite" }, [], false);
    expect(r.defaultChannel).toBe("whapi");
  });

  test("day guest with no history defaults to meta", () => {
    const r = inferGuestOutboundDefaults({ room_type: "day_guest" }, [], false);
    expect(r.defaultChannel).toBe("meta");
  });

  test("last inbound whapi selects whapi", () => {
    const r = inferGuestOutboundDefaults(
      { room_type: "suite" },
      [{ inbox_channel: "whapi", created_at: "2026-07-30T10:00:00Z" }],
      false,
    );
    expect(r.defaultChannel).toBe("whapi");
  });
});

describe("canSendGuestFreeText", () => {
  test("meta blocked when window closed", () => {
    expect(canSendGuestFreeText("meta", { metaOpen: false, whapiSosActive: false })).toBe(false);
  });

  test("whapi allowed unless SOS", () => {
    expect(canSendGuestFreeText("whapi", { metaOpen: false, whapiSosActive: false })).toBe(true);
    expect(canSendGuestFreeText("whapi", { metaOpen: true, whapiSosActive: true })).toBe(false);
  });
});

describe("isMetaWindowOpenFromGuest", () => {
  test("future expiry is open", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(isMetaWindowOpenFromGuest({ wa_window_expires_at: future })).toBe(true);
  });
});
