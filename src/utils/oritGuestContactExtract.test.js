import { describe, expect, test } from "@jest/globals";
import {
  extractGuestContactFromFormBody,
  resolveOritReplyEmail,
  oritThreadGuestLabel,
} from "./oritGuestContactExtract";

const SAMPLE = `שם מלא: שרון טלפון: 0507579741 דוא&quot;ל: sharonozan@gmail.com תוכן ההודעה: שלום רב`;

describe("oritGuestContactExtract", () => {
  test("extracts website form fields", () => {
    const c = extractGuestContactFromFormBody(SAMPLE);
    expect(c.name).toBe("שרון");
    expect(c.phone).toBe("+972507579741");
    expect(c.email).toBe("sharonozan@gmail.com");
  });

  test("resolveOritReplyEmail prefers guest contact and blocks relay", () => {
    expect(resolveOritReplyEmail("ads9@richkid.co.il", "sharonozan@gmail.com")).toBe("sharonozan@gmail.com");
    expect(resolveOritReplyEmail("ads9@richkid.co.il", null)).toBe("");
    expect(resolveOritReplyEmail("guest@example.com", null)).toBe("guest@example.com");
  });

  test("oritThreadGuestLabel shows extracted guest", () => {
    const label = oritThreadGuestLabel({
      from_name: "Website",
      from_email: "noreply@dream-island.co.il",
      guest_contact_name: "שרון",
      guest_contact_email: "sharonozan@gmail.com",
    });
    expect(label).toBe("שרון · sharonozan@gmail.com");
  });
});
