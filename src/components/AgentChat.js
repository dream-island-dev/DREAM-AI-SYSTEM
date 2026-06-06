// src/components/AgentChat.js
// AI chat interface with continuous learning feedback loop.
// After every assistant message the manager can rate (👍/👎) and correct —
// corrections are stored in agent_learning_logs and injected as few-shot
// examples on the next request so the agent never repeats the same mistake.
import { useState, useRef, useEffect, useCallback } from "react";
import { getLocalCorrections, appendLocalLearningLog, saveLearningLog } from "../supabaseClient";
import { DEMO_OPENING_SUGGESTIONS } from "../data/demoAgentProfile";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

// Derive the Supabase Edge Function URL when Supabase is configured
const CHAT_EDGE_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/chat`
  : null;

const USE_DEMO_MODE = !BACKEND_URL && !CHAT_EDGE_URL;

const C = {
  gold: "var(--gold)",
  goldDark: "var(--gold-dark)",
  black: "var(--black)",
  muted: "var(--text-muted)",
  border: "var(--border)",
  card: "var(--card-bg)",
  ivory: "var(--ivory)",
};

// ── Feedback states per message ───────────────────────────────────────────────
// null → not yet rated
// 'liked' → 👍 submitted
// 'correcting' → 👎 clicked, correction input visible
// 'corrected' → correction submitted

export default function AgentChat({ user, agentProfile, onResetProfile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // feedback state map: { [messageId]: 'liked' | 'correcting' | 'corrected' }
  const [feedbackState, setFeedbackState] = useState({});
  const [corrections, setCorrections] = useState({}); // { [messageId]: string }
  const sessionId = useRef(`session_${Date.now()}`);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const buildRequestBody = useCallback(
    (next) => {
      const recentCorrections = getLocalCorrections(agentProfile.id);
      return JSON.stringify({
        action: "chat",
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        agentProfile: {
          systemPrompt: agentProfile.system_prompt,
          department: agentProfile.department,
          displayName: agentProfile.display_name,
        },
        learningLogs: recentCorrections,
        sessionId: sessionId.current,
        // Legacy Apps Script support
        idToken: user?.idToken ?? "",
      });
    },
    [agentProfile, user]
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    const msgId = `msg_u_${Date.now()}`;
    const userMsg = {
      id: msgId,
      role: "user",
      content: text,
      ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
    };

    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      let reply = "";

      if (USE_DEMO_MODE) {
        await new Promise((r) => setTimeout(r, 900));
        reply =
          `שלום ${user?.name ?? ""}! אני ${agentProfile.display_name}.\n\n` +
          `כדי לקבל תשובות אמיתיות יש לדלוק את Edge Function "chat" ב-Supabase.\n` +
          `כרגע אני פועל במצב דמו בלבד.`;
      } else {
        const url = CHAT_EDGE_URL ?? BACKEND_URL;
        const headers = { "Content-Type": "text/plain;charset=utf-8" };
        if (CHAT_EDGE_URL && user?.supabaseAccessToken) {
          headers["Authorization"] = `Bearer ${user.supabaseAccessToken}`;
        }

        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers,
            body: buildRequestBody(next.map((m) => ({ role: m.role, content: m.content }))),
          });
        } catch {
          reply = "⚠️ לא ניתן להתחבר לשרת. בדוק חיבור אינטרנט או שה-Edge Function הועלתה.";
          setMessages((prev) => [...prev, {
            id: `msg_a_${Date.now()}`, role: "assistant", content: reply,
            ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
          }]);
          return;
        }

        if (!res.ok) {
          const status = res.status;
          if (status === 404) {
            reply = `⚠️ Edge Function "chat" עדיין לא הועלתה ל-Supabase.\n\nלהפעלת הסוכן:\n1. כנס ל-Supabase → Edge Functions\n2. צור פונקציה חדשה בשם "chat"\n3. הדבק את הקוד ולחץ Deploy`;
          } else if (status === 401) {
            reply = "⚠️ שגיאת הרשאות — בדוק שה-ANON_KEY מוגדר נכון.";
          } else {
            reply = `⚠️ שגיאת שרת (${status}) — נסה שוב או בדוק את ה-Edge Function.`;
          }
        } else {
          const data = await res.json();
          reply = data.ok ? data.reply : `⚠️ ${data.error ?? "שגיאה לא ידועה מהשרת"}`;
        }
      }

      const assistantId = `msg_a_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: reply,
          ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: "assistant",
          content: `שגיאת רשת: ${String(e)}`,
          ts: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async (msgId, originalResponse, type, correction = null) => {
    const log = {
      agent_profile_id: agentProfile.id,
      manager_id: user?.id,
      conversation_message_id: msgId,
      original_response: originalResponse,
      correction,
      rating: type === "liked" ? 5 : type === "corrected" ? 2 : null,
      feedback_type: type === "corrected" ? "correction" : "rating",
      is_injected: false,
    };

    try {
      await saveLearningLog(log);
    } catch {
      appendLocalLearningLog(log); // fallback
    }

    setFeedbackState((s) => ({
      ...s,
      [msgId]: type === "corrected" ? "corrected" : "liked",
    }));
  };

  const handleThumbsDown = (msgId) => {
    setFeedbackState((s) => ({ ...s, [msgId]: "correcting" }));
  };

  const handleCorrectionSubmit = (msg) => {
    const corrText = (corrections[msg.id] ?? "").trim();
    if (!corrText) return;
    submitFeedback(msg.id, msg.content, "corrected", corrText);
  };

  return (
    <div>
      {/* Agent info header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 16px rgba(201,169,110,0.35)",
            }}
          >
            🤖
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.black }}>
              {agentProfile.display_name}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              מחלקת {agentProfile.department} ·{" "}
              <span style={{ color: "#1A7A4A", fontWeight: 600 }}>פעיל</span>
            </div>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onResetProfile}
          title="הגדר מחדש את הסוכן"
        >
          ⚙️ הגדרות מחדש
        </button>
      </div>

      {USE_DEMO_MODE && (
        <div
          style={{
            background: "#FFF5E8",
            border: "1px solid #F5A623",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 13,
            color: "#7A4A00",
            marginBottom: 16,
          }}
        >
          <strong>מצב דמו</strong> — הסוכן לא מחובר לבינה מלאכותית אמיתית.
          הגדר <code>REACT_APP_BACKEND_URL</code> בקובץ <code>.env</code> כדי לחבר.
        </div>
      )}

      {/* Chat window */}
      <div
        className="card"
        style={{ display: "flex", flexDirection: "column", height: "65vh", marginBottom: 0 }}
      >
        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 20px 8px",
            background: C.ivory,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 16,
                padding: "24px 16px",
              }}
            >
              <span style={{ fontSize: 44 }}>🤖</span>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.black, marginBottom: 4 }}>
                  שלום {user?.name}!
                </div>
                <div style={{ fontSize: 13, color: C.muted, maxWidth: 340 }}>
                  אני {agentProfile.display_name}. מוכן לעבוד.
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
                  {DEMO_OPENING_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion.replace(/^[^\s]+ /, ""));
                      }}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 20,
                        border: "1.5px solid var(--border)",
                        background: "var(--card-bg)",
                        color: C.black,
                        fontSize: 12,
                        fontFamily: "Heebo, sans-serif",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.borderColor = "var(--gold)";
                        e.target.style.background = "rgba(201,169,110,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.borderColor = "var(--border)";
                        e.target.style.background = "var(--card-bg)";
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              {/* Message bubble */}
              <div
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "78%",
                    padding: "12px 16px",
                    borderRadius:
                      msg.role === "user"
                        ? "18px 18px 4px 18px"
                        : "18px 18px 18px 4px",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                    fontSize: 14,
                    background:
                      msg.role === "user"
                        ? "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)"
                        : "#fff",
                    color: msg.role === "user" ? "#0F0F0F" : C.black,
                    border:
                      msg.role === "user" ? "none" : `1px solid ${C.border}`,
                    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
                  }}
                >
                  {msg.content}
                </div>
              </div>

              {/* Timestamp */}
              <div
                style={{
                  fontSize: 10,
                  color: C.muted,
                  marginTop: 4,
                  textAlign: msg.role === "user" ? "right" : "left",
                }}
              >
                {msg.ts}
              </div>

              {/* Feedback UI — only for assistant messages not yet rated */}
              {msg.role === "assistant" && !feedbackState[msg.id] && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 6,
                    paddingRight: 4,
                  }}
                >
                  <button
                    onClick={() => submitFeedback(msg.id, msg.content, "liked")}
                    title="תשובה טובה"
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: "3px 10px",
                      cursor: "pointer",
                      fontSize: 13,
                      color: C.muted,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.borderColor = "#1A7A4A";
                      e.target.style.color = "#1A7A4A";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.color = C.muted;
                    }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => handleThumbsDown(msg.id)}
                    title="תקן את התשובה"
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: "3px 10px",
                      cursor: "pointer",
                      fontSize: 13,
                      color: C.muted,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.borderColor = "#C0392B";
                      e.target.style.color = "#C0392B";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.color = C.muted;
                    }}
                  >
                    👎 תקן
                  </button>
                </div>
              )}

              {/* Liked indicator */}
              {feedbackState[msg.id] === "liked" && (
                <div style={{ fontSize: 11, color: "#1A7A4A", marginTop: 4 }}>
                  ✓ משוב נשמר
                </div>
              )}

              {/* Correction input */}
              {feedbackState[msg.id] === "correcting" && (
                <div
                  style={{
                    marginTop: 10,
                    background: "#FFF5F3",
                    border: "1px solid #FECACA",
                    borderRadius: 10,
                    padding: 14,
                    maxWidth: "78%",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#C0392B",
                      marginBottom: 8,
                    }}
                  >
                    כתוב איך הסוכן היה צריך לענות:
                  </div>
                  <textarea
                    rows={3}
                    placeholder="התשובה הנכונה / ההנחיה לפעמים הבאות..."
                    value={corrections[msg.id] ?? ""}
                    onChange={(e) =>
                      setCorrections((c) => ({ ...c, [msg.id]: e.target.value }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1.5px solid #FECACA",
                      borderRadius: 8,
                      fontFamily: "Heebo, sans-serif",
                      fontSize: 13,
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                  <div
                    style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}
                  >
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setFeedbackState((s) => ({ ...s, [msg.id]: undefined }))
                      }
                    >
                      ביטול
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ background: "#FFF0EE", color: "#C0392B" }}
                      onClick={() => handleCorrectionSubmit(msg)}
                    >
                      שמור תיקון ✓
                    </button>
                  </div>
                </div>
              )}

              {/* Correction saved indicator */}
              {feedbackState[msg.id] === "corrected" && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#C0392B",
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  ✓ תיקון נשמר — הסוכן ילמד ממנו
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: C.muted,
                fontSize: 13,
                padding: "8px 4px",
              }}
            >
              <span style={{ animation: "pulse 1s infinite" }}>💭</span>
              {agentProfile.display_name} מקליד...
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Input row */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: 16,
            borderTop: `1px solid ${C.border}`,
            background: C.card,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`שאל את ${agentProfile.display_name}...`}
            disabled={busy}
            style={{
              flex: 1,
              padding: "13px 16px",
              border: `1.5px solid ${C.border}`,
              borderRadius: 12,
              fontFamily: "Heebo, sans-serif",
              fontSize: 14,
              outline: "none",
              background: C.ivory,
              color: C.black,
            }}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="btn btn-primary"
            style={{ minWidth: 80, opacity: busy || !input.trim() ? 0.55 : 1 }}
          >
            שלח
          </button>
        </div>
      </div>

      {/* Learning log count */}
      <div style={{ marginTop: 10, textAlign: "left", fontSize: 11, color: C.muted }}>
        {(() => {
          try {
            const logs = JSON.parse(
              localStorage.getItem(`learning_logs_${agentProfile.id}`) ?? "[]"
            );
            const corrections = logs.filter((l) => l.feedback_type === "correction");
            return corrections.length > 0
              ? `🧠 ${corrections.length} תיקון(ים) נשמרו — מוזרקים בכל שיחה`
              : "🧠 טרם נשמרו תיקונים";
          } catch {
            return "";
          }
        })()}
      </div>
    </div>
  );
}
