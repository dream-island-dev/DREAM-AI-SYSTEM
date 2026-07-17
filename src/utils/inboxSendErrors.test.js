import {
  formatInboxOutboundError,
  isInboxOutboundTimeout,
  isInboxWindowClosed,
  isMetaSessionWindowOpenForContact,
  isWhapiSessionWindowOpenForContact,
  shouldWarnMetaWindowClosed,
  resolveMetaWindowClosedHint,
  META_WINDOW_CLOSED_WHAPI_HINT,
  META_WINDOW_CLOSED_WHAPI_AVAILABLE_HINT,
} from "./inboxSendErrors";

describe("inboxSendErrors", () => {
  test("detects status timeout", () => {
    expect(isInboxOutboundTimeout({ status: "timeout", error: "x" })).toBe(true);
  });

  test("detects whapi_timeout / timeout_no_response in message", () => {
    expect(
      isInboxOutboundTimeout(
        null,
        "whapi_timeout: timeout_no_response: Whapi did not respond within 45s",
      ),
    ).toBe(true);
  });

  test("format: timeout → Hebrew check-before-resend (no English dump)", () => {
    const msg = formatInboxOutboundError({
      status: "timeout",
      error: "whapi_timeout: timeout_no_response: Whapi did not respond within 45s",
    });
    expect(msg).toContain("לא ודאי");
    expect(msg).toContain("למנוע כפילות");
    expect(msg).not.toMatch(/whapi_timeout/i);
  });

  test("format: hard fail keeps op label + raw detail", () => {
    expect(formatInboxOutboundError({ error: "whapi_text_401: unauthorized" }, null, {
      opLabel: "שגיאת שליחה",
    })).toBe("שגיאת שליחה: whapi_text_401: unauthorized");
  });

  test("detects window_closed status", () => {
    expect(isInboxWindowClosed({ status: "window_closed" })).toBe(true);
  });

  test("format: window_closed → Whapi hint", () => {
    expect(formatInboxOutboundError({ status: "window_closed" })).toBe(META_WINDOW_CLOSED_WHAPI_HINT);
  });

  test("isMetaSessionWindowOpenForContact ignores whapi-only inbound", () => {
    const recent = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(isMetaSessionWindowOpenForContact({
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "whapi" }],
    })).toBe(false);
    expect(isMetaSessionWindowOpenForContact({
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "meta" }],
    })).toBe(true);
  });

  test("isWhapiSessionWindowOpenForContact mirrors whapi inbound only", () => {
    const recent = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(isWhapiSessionWindowOpenForContact({
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "whapi" }],
    })).toBe(true);
    expect(isWhapiSessionWindowOpenForContact({
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "meta" }],
    })).toBe(false);
  });

  test("resolveMetaWindowClosedHint when whapi session is open", () => {
    expect(resolveMetaWindowClosedHint({ whapiSessionOpen: true }))
      .toBe(META_WINDOW_CLOSED_WHAPI_AVAILABLE_HINT);
  });

  test("shouldWarnMetaWindowClosed only when Meta path and Meta window shut", () => {
    const recent = new Date(Date.now() - 3600 * 1000).toISOString();
    const contact = {
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "whapi" }],
    };
    expect(shouldWarnMetaWindowClosed(contact, "whapi")).toBe(false);
    expect(shouldWarnMetaWindowClosed(contact, "meta")).toBe(true);
    expect(shouldWarnMetaWindowClosed({
      messages: [{ direction: "inbound", created_at: recent, inbox_channel: "meta" }],
    }, "meta")).toBe(false);
  });

  test("resolveMetaWindowClosedHint SOS variant", () => {
    expect(resolveMetaWindowClosedHint({ whapiSosActive: true })).toContain("תבנית Meta");
  });
});
