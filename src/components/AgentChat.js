// src/components/AgentChat.js
// Stateful AI chat with:
//   - session_id persisted in localStorage (survives refresh)
//   - Conversation history loaded from Supabase on mount
//   - Google Drive RAG indicator
//   - 👍/👎 feedback → agent_learning_logs

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase, getLocalCorrections, appendLocalLearningLog, saveLearningLog } from "../supabaseClient";
import { DEMO_OPENING_SUGGESTIONS } from "../data/demoAgentProfile";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const BACKEND_URL  = process.env.REACT_APP_BACKEND_URL;
const CHAT_EDGE_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/chat` : null;
const USE_DEMO_MODE = !BACKEND_URL && !CHAT_EDGE_URL;

const C = {
  black: "var(--black)", muted: "var(--text-muted)",
  border: "var(--border)", card: "var(--card-bg)", ivory: "var(--ivory)",
};

// ── Session helpers ───────────────────────────────────────────────────────────

function getOrCreateSessionId(agentId) {
  const key = `session_id_${agentId}`;
  let sid = localStorage.getItem(key);
  if (!sid) {
    sid = `session_${agentId}_${Date.now()}`;
    localStorage.setItem(key, sid);
  }
  return sid;
}

function resetSessionId(agentId) {
  const key = `session_id_${agentId}`;
  const sid = `session_${agentId}_${Date.now()}`;
  localStorage.setItem(key, sid);
  return sid;
}

// ── Load history from Supabase ────────────────────────────────────────────────

async function loadHistory(sessionId) {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from("chat_history")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(30);
    return (data ?? []).map((r, i) => ({
      id: `hist_${i}`,
      role: r.role,
      content: r.content,
      ts: new Date(r.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
      fromHistory: true,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AgentChat({ user, agentProfile, onResetProfile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [driveUsed, setDriveUsed] = useState(false);
  const [feedbackState, setFeedbackState] = useState({});
  const [corrections, setCorrections]     = useState({});

  // Persistent session ID — survives page refresh
  const sessionId = useRef(getOrCreateSessionId(agentProfile.id));
  const endRef    = useRef(null);

  // ── Load history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setLoadingHistory(true);
    loadHistory(sessionId.current).then((hist) => {
      setMessages(hist);
      setLoadingHistory(false);
    });
  }, [agentProfile.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // ── Send message ─────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg = {
      id: `msg_u_${Date.now()}`,
      role: "user",
      content: text,
      ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);
    setDriveUsed(false);

    try {
      let reply = "";

      if (USE_DEMO_MODE) {
        await new Promise((r) => setTimeout(r, 900));
        reply =
          `שלום ${user?.name ?? ""}! אני ${agentProfile.display_name}.\n\n` +
          `כדי לקבל תשובות אמיתיות, יש לדלוק את ה-Edge Function "chat" ב-Supabase.\n` +
          `כרגע פועל במצב דמו.`;
      } else {
        const url = CHAT_EDGE_URL ?? BACKEND_URL;
        const body = JSON.stringify({
          message:   text,
          sessionId: sessionId.current,
          managerId: user?.id ?? "anonymous",
          agentProfile: {
            id:           agentProfile.id,
            systemPrompt: agentProfile.system_prompt,
            department:   agentProfile.department,
            displayName:  agentProfile.display_name,
            driveUrl:     agentProfile.drive_folder_url ?? null,
          },
          learningLogs: getLocalCorrections(agentProfile.id),
        });

        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
        } catch {
          reply = "⚠️ לא ניתן להתחבר לשרת. בדוק חיבור אינטרנט.";
          setMessages((prev) => [...prev, {
            id: `msg_err_${Date.now()}`, role: "assistant", content: reply,
            ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
          }]);
          setBusy(false);
          return;
        }

        if (!res.ok) {
          const s = res.status;
          reply = s === 404
            ? `⚠️ Edge Function "chat" לא נמצאה. יש לדלוק אותה ב-Supabase.`
            : `⚠️ שגיאת שרת (${s}).`;
        } else {
          const data = await res.json();
          reply = data.ok ? data.reply : `⚠️ ${data.error ?? "שגיאה לא ידועה"}`;
          if (data.driveUsed) setDriveUsed(true);
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `msg_a_${Date.now()}`,
          role: "assistant",
          content: reply,
          ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, agentProfile, user]);

  // ── New conversation ─────────────────────────────────────────────────────
  const startNewConversation = () => {
    sessionId.current = resetSessionId(agentProfile.id);
    setMessages([]);
    setFeedbackState({});
    setCorrections({});
    setDriveUsed(false);
  };

  // ── Feedback ─────────────────────────────────────────────────────────────
  const submitFeedback = async (msgId, originalResponse, type, correction = null) => {
    const log = {
      agent_profile_id: agentProfile.id,
      manager_id: user?.id,
      conversation_message_id: msgId,
      original_response: originalResponse,
      correction,
      rating: type === "liked" ? 5 : 2,
      feedback_type: type === "corrected" ? "correction" : "rating",
      is_injected: false,
    };
    try { await saveLearningLog(log); } catch { appendLocalLearningLog(log); }
    setFeedbackState((s) => ({ ...s, [msgId]: type === "corrected" ? "corrected" : "liked" }));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Agent header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
            boxShadow: "0 4px 16px rgba(201,169,110,0.35)",
          }}>🤖</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.black }}>
              {agentProfile.display_name}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {agentProfile.department} ·{" "}
              <span style={{ color: "#1A7A4A", fontWeight: 600 }}>פעיל</span>
              {agentProfile.drive_folder_url && (
                <span style={{ marginRight: 8, color: driveUsed ? "#1A7A4A" : C.muted }}>
                  {" "}· 📁 Drive {driveUsed ? "✓" : ""}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={startNewConversation} title="שיחה חדשה">
            🔄 שיחה חדשה
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onResetProfile} title="הגדר מחדש">
            ⚙️ הגדרות
          </button>
        </div>
      </div>

      {USE_DEMO_MODE && (
        <div style={{
          background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10,
          padding: "12px 16px", fontSize: 13, color: "#7A4A00", marginBottom: 16,
        }}>
          <strong>מצב דמו</strong> — הסוכן לא מחובר ל-AI. הגדר <code>REACT_APP_BACKEND_URL</code>.
        </div>
      )}

      {/* Chat window */}
      <div className="card" style={{ display: "flex", flexDirection: "column", height: "65vh" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px", background: C.ivory }}>

          {/* Loading history indicator */}
          {loadingHistory && (
            <div style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: 20 }}>
              טוען היסטוריית שיחה...
            </div>
          )}

          {/* Empty state with suggestions */}
          {!loadingHistory && messages.length === 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", gap: 16, padding: "24px 16px",
            }}>
              <span style={{ fontSize: 44 }}>🤖</span>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.black, marginBottom: 4 }}>
                  שלום {user?.name}!
                </div>
                <div style={{ fontSize: 13, color: C.muted, maxWidth: 340 }}>
                  אני {agentProfile.display_name}.
                  {agentProfile.is_demo && (
                    <span style={{ display: "block", marginTop: 4, color: "var(--gold-dark)", fontWeight: 600 }}>
                      פרופיל דמו פעיל — ידע מלא על Dream Island
                    </span>
                  )}
                </div>
              </div>
              {/* Quick suggestion chips */}
              <div style={{ width: "100%", maxWidth: 500 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "center", marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  התחל בשאלה:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {DEMO_OPENING_SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => setInput(s.replace(/^[^\s]+\s/, ""))}
                      style={{
                        padding: "8px 14px", borderRadius: 20,
                        border: "1.5px solid var(--border)", background: C.card,
                        color: C.black, fontSize: 12, fontFamily: "Heebo, sans-serif",
                        cursor: "pointer", fontWeight: 500,
                      }}
                      onMouseEnter={(e) => { e.target.style.borderColor = "var(--gold)"; e.target.style.background = "rgba(201,169,110,0.08)"; }}
                      onMouseLeave={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.background = C.card; }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* History separator */}
          {!loadingHistory && messages.length > 0 && messages[0]?.fromHistory && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px" }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.muted }}>היסטוריית שיחה קודמת</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "78%", padding: "12px 16px",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 14,
                  background: msg.role === "user"
                    ? "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)"
                    : "#fff",
                  color: msg.role === "user" ? "#0F0F0F" : C.black,
                  border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                  boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
                  opacity: msg.fromHistory ? 0.75 : 1,
                }}>
                  {msg.content}
                </div>
              </div>

              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textAlign: msg.role === "user" ? "right" : "left" }}>
                {msg.ts}{msg.fromHistory ? " · מהיסטוריה" : ""}
              </div>

              {/* Feedback UI */}
              {msg.role === "assistant" && !msg.fromHistory && !feedbackState[msg.id] && (
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {[
                    { emoji: "👍", title: "תשובה טובה", hoverColor: "#1A7A4A", action: () => submitFeedback(msg.id, msg.content, "liked") },
                    { emoji: "👎 תקן", title: "תקן", hoverColor: "#C0392B", action: () => setFeedbackState((s) => ({ ...s, [msg.id]: "correcting" })) },
                  ].map(({ emoji, title, hoverColor, action }) => (
                    <button key={emoji} onClick={action} title={title}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontSize: 13, color: C.muted, transition: "all 0.15s" }}
                      onMouseEnter={(e) => { e.target.style.borderColor = hoverColor; e.target.style.color = hoverColor; }}
                      onMouseLeave={(e) => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}
                    >{emoji}</button>
                  ))}
                </div>
              )}

              {feedbackState[msg.id] === "liked" && (
                <div style={{ fontSize: 11, color: "#1A7A4A", marginTop: 4 }}>✓ משוב נשמר</div>
              )}

              {feedbackState[msg.id] === "correcting" && (
                <div style={{ marginTop: 10, background: "#FFF5F3", border: "1px solid #FECACA", borderRadius: 10, padding: 14, maxWidth: "78%" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#C0392B", marginBottom: 8 }}>
                    כתוב איך הסוכן היה צריך לענות:
                  </div>
                  <textarea rows={3}
                    placeholder="התשובה הנכונה / ההנחיה לפעמים הבאות..."
                    value={corrections[msg.id] ?? ""}
                    onChange={(e) => setCorrections((c) => ({ ...c, [msg.id]: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #FECACA", borderRadius: 8, fontFamily: "Heebo, sans-serif", fontSize: 13, outline: "none", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setFeedbackState((s) => ({ ...s, [msg.id]: undefined }))}>ביטול</button>
                    <button className="btn btn-sm" style={{ background: "#FFF0EE", color: "#C0392B" }}
                      onClick={() => {
                        const corrText = (corrections[msg.id] ?? "").trim();
                        if (corrText) submitFeedback(msg.id, msg.content, "corrected", corrText);
                      }}>
                      שמור תיקון ✓
                    </button>
                  </div>
                </div>
              )}

              {feedbackState[msg.id] === "corrected" && (
                <div style={{ fontSize: 11, color: "#C0392B", marginTop: 4 }}>✓ תיקון נשמר — הסוכן ילמד ממנו</div>
              )}
            </div>
          ))}

          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13, padding: "8px 4px" }}>
              <span>💭</span> {agentProfile.display_name} מקליד...
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input row */}
        <div style={{ display: "flex", gap: 10, padding: 16, borderTop: `1px solid ${C.border}`, background: C.card }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`שאל את ${agentProfile.display_name}...`}
            disabled={busy}
            style={{ flex: 1, padding: "13px 16px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontFamily: "Heebo, sans-serif", fontSize: 14, outline: "none", background: C.ivory, color: C.black }}
          />
          <button onClick={send} disabled={busy || !input.trim()} className="btn btn-primary"
            style={{ minWidth: 80, opacity: busy || !input.trim() ? 0.55 : 1 }}>
            שלח
          </button>
        </div>
      </div>

      {/* Session info footer */}
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
        <span>🔑 Session: {sessionId.current.slice(-8)}</span>
        <span>
          {(() => {
            try {
              const logs = JSON.parse(localStorage.getItem(`learning_logs_${agentProfile.id}`) ?? "[]");
              const c = logs.filter((l) => l.feedback_type === "correction").length;
              return c > 0 ? `🧠 ${c} תיקון(ים) פעילים` : "🧠 אין תיקונים עדיין";
            } catch { return ""; }
          })()}
        </span>
      </div>
    </div>
  );
}
