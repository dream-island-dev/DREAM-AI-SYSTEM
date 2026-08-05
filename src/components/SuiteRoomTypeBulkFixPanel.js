// Bulk-fix guests split-brain: room is a canonical physical suite but
// room_type says day-pass/Premium Day (P0 2026-08-05 — the opposite direction
// of DayPassRoomBulkFixPanel.js's Premium Day → בילוי יומי correction).
// Second section: same-phone + overlapping-stay duplicate profile pairs, for
// staff to review and delete one side of (delete_guest_profile RPC).
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  fetchSplitBrainSuiteGuests,
  bulkFixSplitBrainSuiteGuests,
  fetchDuplicateGuestPairs,
  deleteGuestProfileById,
} from "../utils/guestSegmentGuard";

function GuestPairCard({ guest, onDelete, busy }) {
  return (
    <div style={{
      flex: 1, minWidth: 220, background: "#fff", border: "1px solid #FCA5A5",
      borderRadius: 8, padding: "10px 12px",
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{guest.name || "—"}</div>
      <div style={{ fontSize: 11, color: "#78716C", marginBottom: 2 }}>{guest.phone}</div>
      <div style={{ fontSize: 11, color: "#B91C1C", marginBottom: 2 }}>
        {guest.room || "—"} · {guest.room_type || "—"} · {guest.status}
      </div>
      <div style={{ fontSize: 11, color: "#78716C", marginBottom: 8 }}>
        {guest.arrival_date}{guest.departure_date ? ` → ${guest.departure_date}` : ""} · #{guest.id}
      </div>
      <button
        type="button"
        onClick={() => onDelete(guest)}
        disabled={busy}
        style={{
          padding: "4px 10px", borderRadius: 8, border: "1px solid #DC2626",
          background: busy ? "#FEE2E2" : "#fff", color: "#DC2626", fontWeight: 700,
          fontSize: 11, cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "⏳ מוחק..." : "🗑 מחק פרופיל זה"}
      </button>
    </div>
  );
}

export default function SuiteRoomTypeBulkFixPanel({ onToast }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [pairs, setPairs] = useState([]);
  const [pairsLoading, setPairsLoading] = useState(false);
  const [pairsError, setPairsError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const toast = useCallback((msg, type = "ok") => onToast?.(msg, type), [onToast]);

  const loadRows = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { guests, error } = await fetchSplitBrainSuiteGuests(supabase);
      if (error) throw error;
      setRows(guests);
      setSelected(new Set(guests.map((g) => g.id)));
    } catch (e) {
      setLoadError(e?.message ?? String(e));
      setRows([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPairs = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setPairsLoading(true);
    setPairsError(null);
    try {
      const { pairs: found, error } = await fetchDuplicateGuestPairs(supabase);
      if (error) throw error;
      setPairs(found);
    } catch (e) {
      setPairsError(e?.message ?? String(e));
      setPairs([]);
    } finally {
      setPairsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
    loadPairs();
  }, [loadRows, loadPairs]);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((g) => g.id))));
  };

  const runBulkFix = async () => {
    const ids = [...selected];
    if (!supabase || ids.length === 0) return;
    setFixing(true);
    try {
      const { updated, error } = await bulkFixSplitBrainSuiteGuests(supabase, ids);
      if (error) throw error;
      toast(`✅ תוקנו ${updated} אורחים — סוג עודכן לסוויטה`, "ok");
      setConfirmOpen(false);
      await loadRows();
    } catch (e) {
      toast("שגיאה בעדכון: " + (e?.message ?? String(e)), "err");
    } finally {
      setFixing(false);
    }
  };

  const handleDeleteGuest = async (guest) => {
    if (typeof window !== "undefined" && !window.confirm(
      `למחוק לצמיתות את הפרופיל של ${guest.name || guest.phone} (#${guest.id})? הפעולה אינה הפיכה.`,
    )) return;
    setDeletingId(guest.id);
    try {
      const result = await deleteGuestProfileById(supabase, guest.id);
      if (!result.ok) throw new Error(result.error);
      toast(`🗑 נמחק: ${guest.name || guest.phone}`, "ok");
      await loadPairs();
    } catch (e) {
      toast("שגיאה במחיקה: " + (e?.message ?? String(e)), "err");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{
      marginBottom: 16,
      background: "#FEF2F2",
      border: "1px solid #DC2626",
      borderRadius: 14,
      padding: "18px 20px",
      direction: "rtl",
    }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: "#991B1B", marginBottom: 6 }}>
        🚨 תיקון אצווה — סוויטה מסווגת בטעות כבילוי יומי
      </div>
      <p style={{ fontSize: 12.5, color: "#7F1D1D", lineHeight: 1.55, margin: "0 0 12px" }}>
        אורחים עם חדר סוויטה אמיתי (מרשימת 26 הסוויטות) אבל סוג פרופיל "בילוי יומי" / "Premium Day" — split-brain.
        התיקון: סוג → <strong>סוויטה</strong> בלבד. לא נוגע בחדר, בסטטוס או בצ׳ק-אין.
      </p>

      {loadError && (
        <div style={{
          background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
          padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 10,
        }}>
          ❌ {loadError}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={loadRows}
          disabled={loading || fixing}
          style={{
            padding: "6px 14px", borderRadius: 8, border: "1px solid #DC2626",
            background: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
          }}
        >
          {loading ? "⏳ טוען..." : "🔄 רענן"}
        </button>
        {!loading && !loadError && (
          <span style={{ fontSize: 12, color: "#991B1B" }}>
            {rows.length === 0 ? "אין אורחים עם split-brain כרגע ✅" : `${rows.length} נמצאו`}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <button type="button" onClick={toggleAll} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 8,
              border: "1px solid #DC2626", background: "#fff", cursor: "pointer",
            }}>
              {selected.size === rows.length ? "נקה בחירה" : "בחר הכל"}
            </button>
            <span style={{ fontSize: 12, color: "#991B1B" }}>{selected.size} נבחרו</span>
          </div>
          <div style={{
            maxHeight: 220, overflowY: "auto", border: "1px solid #FCA5A5",
            borderRadius: 8, background: "#fff", marginBottom: 12,
          }}>
            {rows.map((g) => (
              <label key={g.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                borderBottom: "1px solid #FEE2E2", fontSize: 13, cursor: "pointer",
              }}>
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} />
                <span style={{ fontWeight: 600, flex: 1 }}>{g.name || "—"}</span>
                <span style={{ color: "#B91C1C", fontSize: 11 }}>{g.room} · {g.room_type}</span>
                <span style={{ color: "#78716C", fontSize: 11 }}>{g.phone}</span>
                <span style={{ color: "#78716C", fontSize: 11 }}>{g.status}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={fixing || selected.size === 0}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: fixing || selected.size === 0 ? "#FCA5A5" : "#DC2626",
              color: "#fff", fontWeight: 800, fontSize: 13,
              cursor: fixing || selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            🔧 תקן {selected.size || ""} אורחים לסוויטה
          </button>
        </>
      )}

      {confirmOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 10060,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{
            background: "#fff", borderRadius: 14, padding: "22px 24px", maxWidth: 420,
            width: "100%", direction: "rtl", border: "1px solid #DC2626",
          }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>לאשר תיקון אצווה?</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              {selected.size} אורחים יעברו לסוג <strong>סוויטה</strong>. חדר, סטטוס וצ׳ק-אין לא ישתנו.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={fixing}>ביטול</button>
              <button
                type="button"
                onClick={runBulkFix}
                disabled={fixing}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "#DC2626", color: "#fff", fontWeight: 800,
                }}
              >
                {fixing ? "⏳ מעדכן..." : "כן, עדכן"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed #FCA5A5" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 4 }}>
          👥 כפילויות — אותו טלפון + שהייה חופפת
        </div>
        <p style={{ fontSize: 12, color: "#7F1D1D", lineHeight: 1.5, margin: "0 0 10px" }}>
          שני פרופילים לאותו אורח בטעות. בדקו איזה נכון ומחקו את השני — המחיקה מבטלת גם משימות ממתינות של הפרופיל.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button
            type="button"
            onClick={loadPairs}
            disabled={pairsLoading}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid #DC2626",
              background: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}
          >
            {pairsLoading ? "⏳ טוען..." : "🔄 רענן כפילויות"}
          </button>
          {!pairsLoading && !pairsError && (
            <span style={{ fontSize: 12, color: "#991B1B" }}>
              {pairs.length === 0 ? "אין כפילויות שזוהו כרגע ✅" : `${pairs.length} זוגות נמצאו`}
            </span>
          )}
        </div>
        {pairsError && (
          <div style={{
            background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
            padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 10,
          }}>
            ❌ {pairsError}
          </div>
        )}
        {pairs.map(([a, b], idx) => (
          <div key={`${a.id}-${b.id}-${idx}`} style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <GuestPairCard guest={a} onDelete={handleDeleteGuest} busy={deletingId === a.id} />
            <GuestPairCard guest={b} onDelete={handleDeleteGuest} busy={deletingId === b.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
