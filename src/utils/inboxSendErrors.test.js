import { formatInboxOutboundError, isInboxOutboundTimeout } from "./inboxSendErrors";

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
});
