// src/Chat.js
// ממשק הצ'אט של המנהל. שולח הודעות ל-Backend (action=chat) שמפעיל את Claude
// עם ה-System Prompt וה-Knowledge של המחלקה. מפתח ה-API לעולם לא בצד-לקוח.
import React, { useState, useRef, useEffect } from "react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const C = {
  green: "#1f4a44", greenDeep: "#16322e", gold: "#c9a25a",
  ivory: "#f7f4ec", ink: "#13231f", muted: "#6b7d77", line: "rgba(31,74,68,.14)",
};

export default function Chat({ manager, idToken }) {
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "chat", idToken, messages: next }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.ok ? data.reply : ("שגיאה: " + data.error) }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: "שגיאת רשת: " + String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={shell}>
      <div style={{ background: C.green, color: C.ivory, padding: "18px 24px" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>העוזר של {manager.name || "המנהל"}</div>
        <div style={{ fontSize: 13, color: "#d8bd86" }}>מחלקה: {manager.department || "—"}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 22, background: C.ivory }}>
        {messages.length === 0 && (
          <div style={{ color: C.muted, textAlign: "center", marginTop: 40 }}>
            שלום {manager.name}, אני העוזר שלך. במה אפשר לעזור?
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 12 }}>
            <div style={{
              maxWidth: "78%", padding: "12px 16px", borderRadius: 16, whiteSpace: "pre-wrap", lineHeight: 1.5,
              background: m.role === "user" ? "#fff" : C.green,
              color: m.role === "user" ? C.ink : C.ivory,
              border: m.role === "user" ? `1.5px solid ${C.line}` : "none",
            }}>{m.content}</div>
          </div>
        ))}
        {busy && <div style={{ color: C.muted, textAlign: "center" }}>מקליד…</div>}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 10, padding: 16, borderTop: `1.5px solid ${C.line}` }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="כתוב הודעה…"
          style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontFamily: "Heebo", fontSize: 15 }}
        />
        <button onClick={send} disabled={busy} style={{
          background: C.gold, color: C.greenDeep, border: "none", borderRadius: 12,
          padding: "0 26px", fontWeight: 700, cursor: "pointer", fontFamily: "Heebo",
        }}>שלח</button>
      </div>
    </div>
  );
}

const shell = {
  width: "100%", maxWidth: 760, height: "88vh", background: "#fff", borderRadius: 22,
  display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 20px 60px rgba(31,74,68,.12)",
};
