import { guestPhoneLookupVariants } from "./updateGuestPhoneCascade";

describe("guestPhoneLookupVariants", () => {
  test("Israeli E.164 expands to local and bare digits", () => {
    const v = guestPhoneLookupVariants("+972501234567");
    expect(v).toContain("+972501234567");
    expect(v).toContain("972501234567");
    expect(v).toContain("0501234567");
  });

  test("empty input returns []", () => {
    expect(guestPhoneLookupVariants("")).toEqual([]);
    expect(guestPhoneLookupVariants(null)).toEqual([]);
  });
});
