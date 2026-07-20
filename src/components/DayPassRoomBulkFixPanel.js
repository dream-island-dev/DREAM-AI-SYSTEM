// Bulk-fix guests mis-tagged as Premium Day → plain בילוי יומי (post-import correction).
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  bulkConvertPremiumDayToGenericDayPass,
  fetchPremiumDayMisassignedGuests,
  israelTodayYmd,
} from "../utils/spaUpsellAudience";
import { GENERIC_DAY_PASS_ROOM } from "../data/suiteRegistry";

export default function DayPassRoomBulkFixPanel({ arrivalDate: arrivalDateProp, onDateChange, onToast, onFixed }) {
  const [arrivalDate, setArrivalDate] = useState(arrivalDateProp || israelTodayYmd());
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (arrivalDateProp && arrivalDateProp !== arrivalDate) {
      setArrivalDate(arrivalDateProp);
    }
  }, [arrivalDateProp, arrivalDate]);

  const toast = useCallback((type, msg) => onToast?.(msg, type), [onToast]);

  const loadRows = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { guests, error } = await fetchPremiumDayMisassignedGuests(supabase, { arrivalDate });
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
  }, [arrivalDate]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleDateChange = (next) => {
    setArrivalDate(next);
    onDateChange?.(next);
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((g) => g.id)),
    );
  };

  const runBulkFix = async () => {
    const ids = [...selected];
    if (!supabase || ids.length === 0) return;
    setFixing(true);
    try {
      const { updated, error } = await bulkConvertPremiumDayToGenericDayPass(supabase, ids);
      if (error) throw error;
      toast("ok", `✅ עודכנו ${updated} אורחים ל«${GENERIC_DAY_PASS_ROOM}»`);
      setConfirmOpen(false);
      await loadRows();
      onFixed?.();
    } catch (e) {
      toast("err", "שגיאה בעדכון: " + (e?.message ?? String(e)));
    } finally {
      setFixing(false);
    }
  };

  return (
    <div style={{
      marginBottom: 16,
      background: "#FFFBEB",
      border: "1px solid #D97706",
      borderRadius: 14,
      padding: "18px 20px",
      direction: "rtl",
    }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: "#92400E", marginBottom: 6 }}>
        🔧 תיקון שיוך אצווה — Premium Day → בילוי יומי
      </div>
      <p style={{ fontSize: 12.5, color: "#78350F", lineHeight: 1.55, margin: "0 0 12px" }}>
        לאורחים שסומנו בטעות כ־Premium Day אחרי ייבוא Doc 2. אל תסמן אורחים עם חבילת פרימיום אמיתית.
        השינוי: חדר → <strong>{GENERIC_DAY_PASS_ROOM}</strong>, סוג → <strong>day_guest</strong>.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>תאריך הגעה:</label>
        <input
          type="date"
          value={arrivalDate}
          onChange={(e) => handleDateChange(e.target.value)}
          disabled={loading || fixing}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #FCD34D", fontSize: 13 }}
        />
        <button
          type="button"
          onClick={loadRows}
          disabled={loading || fixing}
          style={{
            padding: "6px 14px", borderRadius: 8, border: "1px solid #D97706",
            background: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
          }}
        >
          {loading ? "⏳ טוען..." : "🔄 רענן"}
        </button>
      </div>

      {loadError && (
        <div style={{
          background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
          padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 10,
        }}>
          ❌ {loadError}
        </div>
      )}

      {!loading && !loadError && rows.length === 0 && (
        <div style={{ fontSize: 13, color: "#92400E" }}>
          אין אורחים עם Premium Day לתאריך {arrivalDate}.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <button type="button" onClick={toggleAll} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 8,
              border: "1px solid #D97706", background: "#fff", cursor: "pointer",
            }}>
              {selected.size === rows.length ? "נקה בחירה" : "בחר הכל"}
            </button>
            <span style={{ fontSize: 12, color: "#92400E" }}>{selected.size} נבחרו</span>
          </div>
          <div style={{
            maxHeight: 200, overflowY: "auto", border: "1px solid #FDE68A",
            borderRadius: 8, background: "#fff", marginBottom: 12,
          }}>
            {rows.map((g) => (
              <label key={g.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                borderBottom: "1px solid #FEF3C7", fontSize: 13, cursor: "pointer",
              }}>
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} />
                <span style={{ fontWeight: 600, flex: 1 }}>{g.name || "—"}</span>
                <span style={{ color: "#B45309", fontSize: 11 }}>{g.room}</span>
                <span style={{ color: "#78716C", fontSize: 11 }}>{g.phone}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={fixing || selected.size === 0}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: fixing || selected.size === 0 ? "#FDE68A" : "#D97706",
              color: "#fff", fontWeight: 800, fontSize: 13,
              cursor: fixing || selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            🏊 החלף {selected.size || ""} אורחים לבילוי יומי
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
            width: "100%", direction: "rtl", border: "1px solid #D97706",
          }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>לאשר תיקון אצווה?</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              {selected.size} אורחים יעברו מ־Premium Day ל־«{GENERIC_DAY_PASS_ROOM}».
              פעולה זו אינה הפיכה אוטומטית.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={fixing}>ביטול</button>
              <button
                type="button"
                onClick={runBulkFix}
                disabled={fixing}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "#D97706", color: "#fff", fontWeight: 800,
                }}
              >
                {fixing ? "⏳ מעדכן..." : "כן, עדכן"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
