import {
  isAmbiguousCombinedRoom,
  mergeGuestProfileSelectedRoom,
  readSelectedSuiteRoomFromProfile,
  taskNeedsRoomDisambiguation,
} from "./guestSelectedSuiteRoom";

describe("guestSelectedSuiteRoom", () => {
  test("combined room label is ambiguous", () => {
    expect(isAmbiguousCombinedRoom("אמטיסט 8 · רובי 14")).toBe(true);
  });

  test("profile stores selected room", () => {
    const profile = mergeGuestProfileSelectedRoom({}, "רובי 14");
    expect(readSelectedSuiteRoomFromProfile(profile)).toBe("רובי 14");
  });

  test("task needs pick when multiple rooms and combined label", () => {
    const task = { guest_id: 1, room_number: "אמטיסט 8 · רובי 14" };
    expect(taskNeedsRoomDisambiguation(task, ["אמטיסט 8", "רובי 14"])).toBe(true);
  });
});
