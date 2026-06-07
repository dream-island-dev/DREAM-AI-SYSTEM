// src/components/GuestsPage.js
// Guest / daily check-in management. Fetch-on-mount (F5-proof).
// Manager can flip a guest to "Room Ready" → fires WhatsApp Trigger 3
// (suites) immediately via the whatsapp-send edge function.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const STATUS_META = {
  expected:   { label: "ממתין",     bg: "#FFF5E8", color: "#B5600A" },
  room_ready: { label: "חדר מוכן",  bg: "#E8F5EF", color: "#1A7A4A" },
  checked_in: { label: "צ'ק-אין",   bg: "#EEF4FF", color: "#2952A3" },
};

export default function GuestsPage() {
  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [toast, setToast]     = useState(null);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guests")
      .select("*")
      .order("arrival_date", { ascending: true })
      .order("id", { ascending: true });
    if (error) showToast("err", "שגיאה: " + error.message);
    else setGuests(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const setStatus = async (guest, status) => {
    if (!supabase) return;
    setBusy(guest.id);
    const patch = { status };
    if (status === "checked_in") patch.checkin_time = new Date().toISOString();
    const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
    if (error) { showToast("err", "שגיאה: " + error.message); setBusy(null); return; }
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...patch } : g)));

    // Room Ready → fire WhatsApp Trigger 3 (suites only) immediately.
    // Safe before the function is deployed: failures are swallowed.
    if (status === "room_ready" && guest.room_type === "suite") {
      try {
        await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "room_ready", guestId: guest.id },
        });
      } catch { /* function may not be deployed yet */ }
    }
    showToast("ok", "עודכן ✓");
    setBusy(null);
  };

  const isSuite = (g) => g.room_type === "suite";

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{guests.length} אורחים</div>
        <button className="btn btn-ghost btn-sm" onClick={fetchGuests} disabled={loading}>
          {loading ? "..." : "↺ רענון"}
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון אורחים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען אורחים...</div>
      ) : guests.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          אין אורחים עדיין — ייבא קובץ צ'ק-אין דרך "העלאת נתונים".
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr>
                <th>שם</th><th>טלפון</th><th>חדר</th><th>סוג</th><th>הגעה</th><th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {guests.map((g) => {
                  const sm = STATUS_META[g.status] ?? STATUS_META.expected;
                  return (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 700 }}>{g.name}</td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{g.phone ?? "—"}</td>
                      <td>{g.room ?? "—"}</td>
                      <td>
                        <span style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: isSuite(g) ? "rgba(201,169,110,0.2)" : "var(--ivory)",
                          color: isSuite(g) ? "var(--gold-dark)" : "var(--text-muted)",
                        }}>{isSuite(g) ? "👑 סוויטה" : "סטנדרט"}</span>
                      </td>
                      <td style={{ fontSize: 13 }}>{g.arrival_date ?? "—"}</td>
                      <td>
                        <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: sm.bg, color: sm.color }}>
                          {sm.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {g.status !== "room_ready" && (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "room_ready")}
                              style={{ background: "#E8F5EF", color: "#1A7A4A" }}>
                              ✓ חדר מוכן
                            </button>
                          )}
                          {g.status !== "checked_in" && (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "checked_in")}
                              style={{ background: "#EEF4FF", color: "#2952A3" }}>
                              🛎️ צ'ק-אין
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
