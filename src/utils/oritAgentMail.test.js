import { computeSlaDeadline, isReadOnlyMailbox } from "./oritAgentMail";

describe("oritAgentMail", () => {
  test("computeSlaDeadline adds hours from received_at", () => {
    const start = "2026-07-08T10:00:00.000Z";
    expect(computeSlaDeadline(start, 72)).toBe("2026-07-11T10:00:00.000Z");
  });

  test("isReadOnlyMailbox defaults true", () => {
    expect(isReadOnlyMailbox({})).toBe(true);
    expect(isReadOnlyMailbox({ read_only_mode: true })).toBe(true);
    expect(isReadOnlyMailbox({ read_only_mode: false })).toBe(false);
  });
});
