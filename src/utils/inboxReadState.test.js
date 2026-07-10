import {
  applyAllReadCursors,
  buildGroupedRosterSections,
  buildReadCursorsMap,
  contactUnreadCount,
  countUnreadInbound,
  getReadCursorAt,
  inboxReadCursorKey,
  isRecentlyActive,
  sortContactsRecentFirst,
  INBOX_RECENT_ACTIVITY_MS,
} from "./inboxReadState";

function contact(phone, lastAt, extra = {}) {
  return {
    phone,
    messages: [{ id: 1, direction: "inbound", created_at: lastAt, ...extra }],
    ...extra,
  };
}

describe("inboxReadCursorKey + buildReadCursorsMap", () => {
  test("keys are phone::channel", () => {
    expect(inboxReadCursorKey("+972501", "meta")).toBe("+972501::meta");
    expect(inboxReadCursorKey("+972501", "whapi")).toBe("+972501::whapi");
  });

  test("buildReadCursorsMap hydrates threadKey keys (default meta)", () => {
    const map = buildReadCursorsMap([
      { phone: "+972501", last_read_at: "2026-07-07T11:00:00Z" },
      { phone: "+972502", inbox_channel: "whapi", last_read_at: "2026-07-07T12:00:00Z" },
    ]);
    expect(map.get("+972501::meta")).toBe("2026-07-07T11:00:00Z");
    expect(map.get("+972502::whapi")).toBe("2026-07-07T12:00:00Z");
    expect(map.has("+972501")).toBe(false);
  });

  test("getReadCursorAt falls back to legacy phone-only key", () => {
    const legacy = new Map([["+972501", "2026-07-07T11:00:00Z"]]);
    expect(getReadCursorAt(legacy, "+972501", "meta")).toBe("2026-07-07T11:00:00Z");
  });
});

describe("countUnreadInbound + read cursor", () => {
  test("opened thread (cursor) does not count as unread", () => {
    const msgs = [
      { id: 1, direction: "inbound", created_at: "2026-07-07T10:00:00Z" },
      { id: 2, direction: "inbound", created_at: "2026-07-07T11:00:00Z" },
    ];
    expect(countUnreadInbound(msgs, "2026-07-07T11:30:00Z")).toBe(0);
    expect(countUnreadInbound(msgs, "2026-07-07T10:30:00Z")).toBe(1);
  });

  test("applyAllReadCursors marks inbound at or before cursor as _read", () => {
    const rows = [
      { phone: "+972501", direction: "inbound", created_at: "2026-07-07T10:00:00Z" },
      { phone: "+972501", direction: "inbound", created_at: "2026-07-07T12:00:00Z" },
    ];
    const map = new Map([["+972501::meta", "2026-07-07T11:00:00Z"]]);
    const out = applyAllReadCursors(rows, map);
    expect(out[0]._read).toBe(true);
    expect(out[1]._read).toBeUndefined();
  });

  test("applyAllReadCursors is channel-scoped (meta cursor ignores whapi)", () => {
    const rows = [
      { phone: "+972501", inbox_channel: "whapi", direction: "inbound", created_at: "2026-07-07T10:00:00Z" },
    ];
    const map = new Map([["+972501::meta", "2026-07-07T11:00:00Z"]]);
    const out = applyAllReadCursors(rows, map);
    expect(out[0]._read).toBeUndefined();
  });
});

describe("buildGroupedRosterSections — recent pinned first", () => {
  const sortRosterContacts = (list) => [...list];
  const opts = {
    getInboxRosterSegmentMeta: (key, lang) => ({ label: key, bg: "#fff", fg: "#000" }),
    INBOX_ROSTER_SEGMENT_ORDER: ["future"],
    classifyInboxContactSegment: () => "future",
    sortRosterContacts,
  };

  test("recent section appears first and dedupes from segments below", () => {
    const now = Date.now();
    const recentAt = new Date(now - 1000).toISOString();
    const oldAt = new Date(now - INBOX_RECENT_ACTIVITY_MS - 1000).toISOString();
    const contacts = [
      contact("+972501", recentAt, { humanRequested: false }),
      contact("+972502", oldAt, { humanRequested: true }),
    ];
    const sections = buildGroupedRosterSections(contacts, "activity", "he", opts);
    expect(sections[0].key).toBe("recent");
    expect(sections[0].contacts).toHaveLength(1);
    expect(sections[0].contacts[0].phone).toBe("+972501");
    const allPhones = sections.flatMap((s) => s.contacts.map((c) => c.phone));
    expect(allPhones.filter((p) => p === "+972501")).toHaveLength(1);
  });
});

describe("sortContactsRecentFirst", () => {
  const sortRosterContacts = (list, mode) => {
    if (mode === "name") return [...list].sort((a, b) => a.phone.localeCompare(b.phone));
    return [...list].sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.created_at ?? "";
      const bLast = b.messages[b.messages.length - 1]?.created_at ?? "";
      return bLast.localeCompare(aLast);
    });
  };

  test("recent contacts float above older when sort mode is arrival", () => {
    const now = Date.now();
    const recentAt = new Date(now - 2000).toISOString();
    const oldAt = new Date(now - INBOX_RECENT_ACTIVITY_MS - 5000).toISOString();
    const contacts = [
      contact("+972502", oldAt),
      contact("+972501", recentAt),
    ];
    const sorted = sortContactsRecentFirst(contacts, "name", sortRosterContacts);
    expect(sorted[0].phone).toBe("+972501");
  });
});

describe("isRecentlyActive", () => {
  test("within 24h window", () => {
    const now = Date.now();
    const c = contact("+972501", new Date(now - 3600_000).toISOString());
    expect(isRecentlyActive(c, now)).toBe(true);
  });
});

describe("contactUnreadCount", () => {
  test("delegates to cursor map via threadKey", () => {
    const c = contact("+972501", "2026-07-07T12:00:00Z");
    const map = new Map([["+972501::meta", "2026-07-07T13:00:00Z"]]);
    expect(contactUnreadCount(c, map)).toBe(0);
  });

  test("mark-as-read cursor clears unread filter membership", () => {
    const c = contact("+972501", "2026-07-07T12:00:00Z", {
      threadKey: "+972501::meta",
      inbox_channel: "meta",
    });
    expect(contactUnreadCount(c, new Map())).toBe(1);
    const afterMark = new Map([["+972501::meta", "2026-07-07T12:00:01Z"]]);
    expect(contactUnreadCount(c, afterMark)).toBe(0);
  });
});
