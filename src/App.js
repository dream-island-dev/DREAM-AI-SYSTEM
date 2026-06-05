// src/App.js
// ניהול מצב ההתחברות והניתוב: כניסה → אימות מול ה-Backend → צ'אט המחלקה.
import React, { useEffect, useState } from "react";
import { initGoogleSignIn } from "./googleAuth";
import Chat from "./Chat";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const C = {
  green: "#1f4a44", greenDeep: "#16322e", gold: "#c9a25a",
  ivory: "#f7f4ec", ink: "#13231f", muted: "#6b7d77",
};

export default function App() {
  // status: signedOut | authorizing | unauthorized | ready | error
  const [status, setStatus] = useState("signedOut");
  const [manager, setManager] = useState(null);
  const [idToken, setIdToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "signedOut") {
      initGoogleSignIn(handleCredential);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleCredential(cred) {
    setStatus("authorizing");
    setIdToken(cred.credential);
    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        // text/plain = "simple request" → ללא preflight; Apps Script מחזיר גוף קריא.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "lookup", idToken: cred.credential }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "lookup_failed"); setStatus("error"); return; }
      if (!data.found) { setStatus("unauthorized"); return; }
      setManager(data.manager);
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  if (status === "ready" && manager) {
    return (
      <div dir="rtl" style={wrap}>
        <Chat manager={manager} idToken={idToken} />
      </div>
    );
  }

  return (
    <div dir="rtl" style={wrap}>
      <div style={card}>
        <div style={{ letterSpacing: ".4em", color: C.gold, fontWeight: 600, marginBottom: 26 }}>
          D R E A M&nbsp;&nbsp;I S L A N D
        </div>
        <h1 style={{ color: C.green, fontSize: 26, marginBottom: 10 }}>מערכת ה-AI לניהול</h1>

        {status === "signedOut" && (
          <>
            <p style={{ color: C.muted, marginBottom: 28 }}>
              התחבר עם חשבון הגוגל שלך כדי להיכנס לעוזר האישי שלך.
            </p>
            <div id="gsi-button" style={{ display: "flex", justifyContent: "center" }} />
          </>
        )}

        {status === "authorizing" && (
          <p style={{ color: C.muted }}>מאמת זהות ומאתר את המחלקה שלך…</p>
        )}

        {status === "unauthorized" && (
          <>
            <p style={{ color: "#c0492f", fontWeight: 600, marginBottom: 8 }}>
              האימייל הזה לא רשום במערכת.
            </p>
            <p style={{ color: C.muted }}>
              ודא שמילאת את שאלון האפיון עם אותו אימייל גוגל, או פנה למנהל המערכת.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <p style={{ color: "#c0492f", fontWeight: 600, marginBottom: 8 }}>אירעה תקלה</p>
            <p style={{ color: C.muted, direction: "ltr", fontSize: 13 }}>{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

const wrap = {
  fontFamily: "Heebo, sans-serif", minHeight: "100vh", background: "#f7f4ec",
  color: "#13231f", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const card = {
  maxWidth: 440, width: "100%", background: "#fff", borderRadius: 22, padding: "46px 36px",
  textAlign: "center", boxShadow: "0 20px 60px rgba(31,74,68,.12)",
};
