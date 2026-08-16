// src/components/EzgoApiCodeMappingPanel.js
// EZGO live API sync — Phase 1 reference-data bootstrap UI (see
// C:\Users\mikek\.claude\plans\robust-hatching-sunbeam.md). Two one-time
// mapping queues, same UX spirit as SpaBoard.js's UnmatchedPanel (unknown
// external code -> staff picks the internal record, once):
//
//   1. EZGO Activities.Timing.Worker.WorkerId -> spa_therapists.id
//      (no name is ever sent in the live payload — genuinely can't be
//      auto-resolved; confirmed EZGO's own "code decoding" API doesn't
//      cover this either).
//   2. EZGO Reservations.Room.RoomId -> canonical suite name
//      (most of this table self-bootstraps for free by cross-referencing
//      already-known guests.order_number; this panel is only for the
//      RoomId values that bootstrap couldn't resolve unambiguously).
//
// This panel writes ONLY to spa_therapists.ezgo_worker_id and
// ezgo_suite_room_map — never to guests/suite_rooms/spa_appointments, per
// the approved Phase 1 scope.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY, PREMIUM_DAY_ROOMS, GENERIC_DAY_PASS_ROOM } from "../data/suiteRegistry";

const SUITE_DROPDOWN_OPTIONS = [...SUITE_REGISTRY, ...PREMIUM_DAY_ROOMS, GENERIC_DAY_PASS_ROOM];

const MATCHED_VIA_LABELS = {
  csv_verified: "מאומת מול דוח EZGO",
  auto_bootstrap: "לא ודאי (הסקה פנימית)",
  manual: "ידני",
};

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const rowStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid rgba(201,169,110,0.25)",
  borderRadius: 10,
  padding: "10px 14px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const selectStyle = { fontSize: 12, borderRadius: 6, padding: "4px 8px" };

function ConfirmButton({ disabled, onClick, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: disabled ? "rgba(255,255,255,0.08)" : "var(--gold)",
        color: disabled ? "rgba(255,255,255,0.4)" : "#412402",
        fontWeight: 700,
      }}
    >
      {busy ? "שומר..." : children}
    </button>
  );
}

function WorkerMappingSection({ showToast }) {
  const [rows, setRows] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [choice, setChoice] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: seen, error: seenErr }, { data: th, error: thErr }] = await Promise.all([
      supabase.from("ezgo_worker_ids_seen").select("*").order("event_count", { ascending: false }),
      supabase.from("spa_therapists").select("id, name, active, ezgo_worker_id").order("name"),
    ]);
    if (seenErr) console.error("[EzgoApiCodeMappingPanel] ezgo_worker_ids_seen:", seenErr.message);
    if (thErr) console.error("[EzgoApiCodeMappingPanel] spa_therapists:", thErr.message);
    const mappedIds = new Set((th ?? []).map((t) => t.ezgo_worker_id).filter((v) => v != null));
    setRows((seen ?? []).filter((r) => !mappedIds.has(r.ezgo_worker_id)));
    setTherapists(th ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unmappedTherapists = therapists.filter((t) => t.ezgo_worker_id == null);

  async function handleAssign(row) {
    const therapistId = choice[row.ezgo_worker_id];
    if (!therapistId) return;
    const { error } = await supabase
      .from("spa_therapists")
      .update({ ezgo_worker_id: row.ezgo_worker_id })
      .eq("id", Number(therapistId));
    if (error) {
      showToast(`שגיאה בשיוך מטפל/ת: ${error.message}`, "err");
      return;
    }
    showToast(`✓ WorkerId ${row.ezgo_worker_id} שויך`);
    load();
  }

  if (loading) return <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)" }}>טוען...</div>;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-light)", marginBottom: 6 }}>
        👤 מיפוי מטפלים — EZGO WorkerId ({rows.length} ממתינים)
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 10 }}>
        ה-API של EZGO לא שולח שם מטפל/ת, רק מספר פנימי — יש לשייך פעם אחת לכל מטפל/ת, ומכאן זה יזוהה אוטומטית.
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 13, color: "rgba(232,201,138,0.5)" }}>אין קודים ממתינים לשיוך כרגע.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => (
            <div key={row.ezgo_worker_id} style={rowStyle}>
              <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                <strong>WorkerId {row.ezgo_worker_id}</strong>
                <span style={{ color: "rgba(232,201,138,0.5)" }}>
                  {" "}· נצפה {row.event_count} פעמים · לאחרונה {fmtTimestamp(row.last_seen_at)}
                  {row.sample_order_id ? ` · הזמנה לדוגמה #${row.sample_order_id}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  style={selectStyle}
                  value={choice[row.ezgo_worker_id] ?? ""}
                  onChange={(e) => setChoice((prev) => ({ ...prev, [row.ezgo_worker_id]: e.target.value }))}
                >
                  <option value="">— בחר/י מטפל/ת —</option>
                  {unmappedTherapists.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (לא פעיל/ה)"}</option>
                  ))}
                </select>
                <ConfirmButton disabled={!choice[row.ezgo_worker_id]} onClick={() => handleAssign(row)}>
                  ✓ שייך
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomMappingSection({ showToast }) {
  const [rows, setRows] = useState([]);
  const [mapped, setMapped] = useState([]);
  const [choice, setChoice] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: seen, error: seenErr }, { data: mp, error: mpErr }] = await Promise.all([
      supabase.from("ezgo_room_ids_seen").select("*").order("event_count", { ascending: false }),
      supabase.from("ezgo_suite_room_map").select("*"),
    ]);
    if (seenErr) console.error("[EzgoApiCodeMappingPanel] ezgo_room_ids_seen:", seenErr.message);
    if (mpErr) console.error("[EzgoApiCodeMappingPanel] ezgo_suite_room_map:", mpErr.message);
    const mappedIds = new Set((mp ?? []).map((m) => m.ezgo_room_id));
    setRows((seen ?? []).filter((r) => !mappedIds.has(r.ezgo_room_id)));
    setMapped(mp ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAssign(row) {
    const suiteName = choice[row.ezgo_room_id];
    if (!suiteName) return;
    const { error } = await supabase
      .from("ezgo_suite_room_map")
      .insert({ ezgo_room_id: row.ezgo_room_id, suite_name: suiteName, matched_via: "manual" });
    if (error) {
      showToast(`שגיאה בשיוך חדר: ${error.message}`, "err");
      return;
    }
    showToast(`✓ RoomId ${row.ezgo_room_id} שויך ל-${suiteName}`);
    load();
  }

  if (loading) return <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)" }}>טוען...</div>;

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-light)", marginBottom: 6 }}>
        🏠 מיפוי חדרים — EZGO RoomId ({rows.length} ממתינים · {mapped.length} כבר משויכים)
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 10 }}>
        רוב המיפוי הזה מזהה את עצמו אוטומטית מול הזמנות שכבר ידועות מהמייל — כאן רק מה שנשאר לא ברור. RoomId=0 (עדיין לא שובץ חדר פיזי) לא מופיע כאן בכלל.
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 13, color: "rgba(232,201,138,0.5)" }}>אין קודים ממתינים לשיוך כרגע.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => (
            <div key={row.ezgo_room_id} style={rowStyle}>
              <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                <strong>RoomId {row.ezgo_room_id}</strong>
                <span style={{ color: "rgba(232,201,138,0.5)" }}>
                  {" "}· נצפה {row.event_count} פעמים · לאחרונה {fmtTimestamp(row.last_seen_at)}
                  {row.sample_order_id ? ` · הזמנה לדוגמה #${row.sample_order_id}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  style={selectStyle}
                  value={choice[row.ezgo_room_id] ?? ""}
                  onChange={(e) => setChoice((prev) => ({ ...prev, [row.ezgo_room_id]: e.target.value }))}
                >
                  <option value="">— בחר/י סוויטה —</option>
                  {SUITE_DROPDOWN_OPTIONS.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <ConfirmButton disabled={!choice[row.ezgo_room_id]} onClick={() => handleAssign(row)}>
                  ✓ שייך
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {!!mapped.length && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "rgba(232,201,138,0.75)" }}>
            הצג {mapped.length} חדרים שכבר משויכים
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {[...mapped].sort((a, b) => a.ezgo_room_id - b.ezgo_room_id).map((m) => (
              <div key={m.ezgo_room_id} style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", display: "flex", gap: 8 }}>
                <span style={{ minWidth: 70 }}>RoomId {m.ezgo_room_id}</span>
                <span>→</span>
                <span style={{ fontWeight: 700, color: "rgba(232,201,138,0.85)" }}>{m.suite_name}</span>
                <span style={{ color: "rgba(232,201,138,0.4)" }}>
                  ({MATCHED_VIA_LABELS[m.matched_via] ?? m.matched_via})
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export default function EzgoApiCodeMappingPanel({ showToast }) {
  const notify = showToast ?? (() => {});
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--gold-light)", marginBottom: 4 }}>
        🔌 EZGO API — מיפוי קודים חד-פעמי
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 16 }}>
        שלב הכנה בלבד (Phase 1) — לא נכתב עדיין שום דבר לפרופיל אורח/חדר/תור. מטרת המסך: לתרגם קודים פנימיים של EZGO למידע שלנו, פעם אחת לכל קוד.
      </div>
      <WorkerMappingSection showToast={notify} />
      <RoomMappingSection showToast={notify} />
    </div>
  );
}
