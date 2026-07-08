// src/components/WhatsAppInbox.test.js
// Session 125 P1-D — stable thread + WhatsApp-order roster.
// (1) mergeThreadRows: opening a thread / «🔄 רענן היסטוריה» must NEVER lose
//     visible messages (additive merge, _read preserved).
// (2) groupByPhone: strict latest-message-desc (Mike: «פעילות») — no unread/
//     alert reordering in the base roster order.

import { mergeThreadRows, groupByPhone } from "./WhatsAppInbox";

function msg(id, createdAt, extra = {}) {
  return {
    id,
    phone: "972500000001",
    direction: "inbound",
    message: `msg ${id}`,
    created_at: createdAt,
    ...extra,
  };
}

describe("mergeThreadRows — additive thread merge (P1-D)", () => {
  test("11 local messages + smaller fetched window → all 11 survive (open → away → back)", () => {
    const local = Array.from({ length: 11 }, (_, i) =>
      msg(`m${i}`, `2026-07-06T10:${String(i).padStart(2, "0")}:00Z`),
    );
    // DB window returns only the newest 5 (e.g. THREAD_HISTORY_LIMIT hit).
    const fetched = local.slice(6).map((m) => ({ ...m }));
    const merged = mergeThreadRows(local, fetched);
    expect(merged).toHaveLength(11);
    expect(merged.map((m) => m.id)).toEqual(local.map((m) => m.id));
  });

  test("preserves local _read flag when the fetched row replaces it", () => {
    const local = [msg("a", "2026-07-06T10:00:00Z", { _read: true })];
    const fetched = [msg("a", "2026-07-06T10:00:00Z", { message: "updated text" })];
    const merged = mergeThreadRows(local, fetched);
    expect(merged).toHaveLength(1);
    expect(merged[0]._read).toBe(true);
    expect(merged[0].message).toBe("updated text");
  });

  test("adds rows missing locally, sorted ascending by created_at", () => {
    const local = [msg("b", "2026-07-06T10:05:00Z")];
    const fetched = [
      msg("a", "2026-07-06T10:00:00Z"),
      msg("c", "2026-07-06T10:10:00Z"),
    ];
    const merged = mergeThreadRows(local, fetched);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  test("empty fetched window changes nothing", () => {
    const local = [msg("a", "2026-07-06T10:00:00Z"), msg("b", "2026-07-06T10:01:00Z")];
    expect(mergeThreadRows(local, [])).toHaveLength(2);
    expect(mergeThreadRows(local, null)).toHaveLength(2);
  });

  test("fetchAll additive merge — realtime row during fetch survives full revalidate", () => {
    const realtimeRow = msg("rt", "2026-07-08T18:30:00Z", { phone: "972524476422" });
    const local = [realtimeRow];
    const fetchAllWindow = [
      msg("old", "2026-07-08T10:00:00Z", { phone: "972500000099" }),
    ];
    const merged = mergeThreadRows(local, fetchAllWindow);
    expect(merged.map((m) => m.id)).toEqual(["old", "rt"]);
  });
});

describe("groupByPhone — strict latest-message-desc (WhatsApp order)", () => {
  test("most recent conversation first, regardless of unread/human_requested", () => {
    const rows = [
      // Contact A: old unread inbound + human request — used to pin to top.
      msg("a1", "2026-07-06T08:00:00Z", { phone: "972500000001", human_requested: true }),
      // Contact B: newer plain message.
      msg("b1", "2026-07-06T09:00:00Z", { phone: "972500000002" }),
      // Contact C: newest, already answered (outbound last).
      msg("c1", "2026-07-06T10:00:00Z", { phone: "972500000003", direction: "outbound" }),
    ];
    const contacts = groupByPhone(rows);
    expect(contacts.map((c) => c.phone)).toEqual([
      "972500000003",
      "972500000002",
      "972500000001",
    ]);
    // Alert state still carried for the 🚨 section/badges — just not for order.
    expect(contacts[2].humanRequested).toBe(true);
  });

  test("new inbound bumps its contact to the top (roster bump on realtime INSERT)", () => {
    const rows = [
      msg("a1", "2026-07-06T08:00:00Z", { phone: "972500000001" }),
      msg("b1", "2026-07-06T09:00:00Z", { phone: "972500000002" }),
      msg("a2", "2026-07-06T11:00:00Z", { phone: "972500000001" }),
    ];
    const contacts = groupByPhone(rows);
    expect(contacts[0].phone).toBe("972500000001");
  });
});
