// src/components/cms/CMSSecurityPanel.js
// Sprint 7.1/7.2 — first concrete page mounted behind <CMSGate>. Shows the
// live session/AAL state from AuthContext and lets an admin manage their
// own TOTP factors. This is the proof-of-concept surface for the new CMS
// auth layer — see CLAUDE.md §10 session 7-bis for the architecture notes.
import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../context/AuthContext";

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 700, color: "var(--black)" }}>{value}</span>
    </div>
  );
}

export default function CMSSecurityPanel() {
  const { session, aal, signOutCms } = useAuth();
  const [factors, setFactors] = useState([]);
  const [loadingFactors, setLoadingFactors] = useState(true);
  const [toast, setToast] = useState(null);

  const loadFactors = async () => {
    setLoadingFactors(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    setLoadingFactors(false);
    if (error) { setToast({ type: "err", msg: error.message }); return; }
    setFactors(data?.totp ?? []);
  };

  useEffect(() => { loadFactors(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleUnenroll = async (factorId) => {
    if (!window.confirm("להסיר את ההתקן הזה? תצטרך להגדיר אימות דו-שלבי מחדש בכניסה הבאה ל-CMS.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) { setToast({ type: "err", msg: error.message }); return; }
    setToast({ type: "ok", msg: "✅ ההתקן הוסר" });
    loadFactors();
  };

  const expiresAt = session?.expires_at ? new Date(session.expires_at * 1000) : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><h3>🔐 מצב ההתחברות המאובטחת</h3></div>
        <div style={{ padding: 18, display: "grid", gap: 10, fontSize: 14 }}>
          <Row label="משתמש" value={session?.user?.email ?? "—"} />
          <Row
            label="רמת אימות (AAL)"
            value={aal.currentLevel === "aal2" ? "✅ aal2 — אומת דו-שלבי" : (aal.currentLevel ?? "—")}
          />
          <Row label="ההפעלה בתוקף עד" value={expiresAt ? expiresAt.toLocaleString("he-IL") : "—"} />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>📱 התקני אימות (Authenticator)</h3></div>
        <div style={{ padding: 18 }}>
          {loadingFactors ? (
            <div style={{ color: "var(--text-muted)" }}>טוען...</div>
          ) : factors.length === 0 ? (
            <div style={{ color: "var(--text-muted)" }}>לא נמצאו התקנים רשומים</div>
          ) : (
            factors.map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 0", borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: "var(--black)" }}>{f.friendly_name || "Authenticator"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    סטטוס: {f.status === "verified" ? "✅ פעיל" : "⚠ לא מאומת"} · נוצר{" "}
                    {new Date(f.created_at).toLocaleDateString("he-IL")}
                  </div>
                </div>
                <button className="btn" onClick={() => handleUnenroll(f.id)} style={{ color: "#c0392b" }}>
                  הסר
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={signOutCms}>
        🚪 יציאה מהמערכת
      </button>

      {toast && (
        <div
          style={{
            position: "fixed", bottom: 24, left: 24, zIndex: 3000,
            background: toast.type === "ok" ? "#2e7d32" : "#c0392b",
            color: "#fff", padding: "12px 18px", borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)", fontSize: 13, fontWeight: 600,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
