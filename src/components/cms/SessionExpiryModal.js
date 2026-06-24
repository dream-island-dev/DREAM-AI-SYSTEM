// src/components/cms/SessionExpiryModal.js
// Sprint 7.1 — shown only when AuthContext's silent proactive refresh has
// already failed (not on every expiry — see AuthContext.scheduleRefresh).
// Non-intrusive: a single clear choice, no auto-redirect surprise.
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";

export default function SessionExpiryModal() {
  const { extendSession, signOutCms } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleExtend = async () => {
    setBusy(true);
    const ok = await extendSession();
    setBusy(false);
    if (!ok) setFailed(true);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        direction: "rtl",
      }}
    >
      <div
        style={{
          background: "var(--card-bg)", borderRadius: 14, padding: "32px 28px",
          maxWidth: 380, width: "90%", textAlign: "center",
          border: "1px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ fontSize: 34, marginBottom: 10 }}>🔐</div>
        <div style={{ fontWeight: 800, fontSize: 17, color: "var(--black)", marginBottom: 8 }}>
          ההתחברות המאובטחת עומדת לפוג
        </div>

        {!failed ? (
          <>
            <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
              לחץ להמשך העבודה במערכת ה-CMS בלי לאבד את ההתקדמות שלך
            </div>
            <button onClick={handleExtend} disabled={busy} className="btn btn-primary" style={{ width: "100%" }}>
              {busy ? "מאריך..." : "🔄 הארך הפעלה"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: "#c0392b", marginBottom: 20 }}>
              לא ניתן להאריך את ההפעלה — יש להתחבר מחדש
            </div>
            <button onClick={signOutCms} className="btn btn-primary" style={{ width: "100%" }}>
              חזרה למסך התחברות
            </button>
          </>
        )}
      </div>
    </div>
  );
}
