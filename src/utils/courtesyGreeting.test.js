import {
  isGuestGreetingMessage,
  isLowValueCourtesyMessage,
} from "./courtesyGreeting";

describe("courtesyGreeting", () => {
  test("greetings are not courtesy silent-exit", () => {
    expect(isGuestGreetingMessage("היי")).toBe(true);
    expect(isGuestGreetingMessage("שלום")).toBe(true);
    expect(isGuestGreetingMessage("היי!")).toBe(true);
    expect(isGuestGreetingMessage("היי שלום")).toBe(true);
    expect(isGuestGreetingMessage("שלום היי")).toBe(true);
    expect(isGuestGreetingMessage("hello")).toBe(true);
    expect(isLowValueCourtesyMessage("היי")).toBe(false);
    expect(isLowValueCourtesyMessage("שלום")).toBe(false);
  });

  test("closers stay courtesy-only", () => {
    expect(isLowValueCourtesyMessage("תודה")).toBe(true);
    expect(isLowValueCourtesyMessage("תודה רבה")).toBe(true);
    expect(isLowValueCourtesyMessage("בסדר")).toBe(true);
    expect(isLowValueCourtesyMessage("ok")).toBe(true);
    expect(isGuestGreetingMessage("תודה")).toBe(false);
  });

  test("real questions are neither greeting nor courtesy", () => {
    expect(isGuestGreetingMessage("מה שעות הכניסה?")).toBe(false);
    expect(isLowValueCourtesyMessage("מה שעות הכניסה?")).toBe(false);
  });
});
