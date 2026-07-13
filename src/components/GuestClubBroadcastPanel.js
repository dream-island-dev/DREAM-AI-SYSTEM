// src/components/GuestClubBroadcastPanel.js
// Staff broadcast to active club members (consent-gated Zero-Spam).

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

export default function GuestClubBroadcastPanel({ activeCount, onToast }) {
  const [channel, setChannel] = useState("whapi"); // whapi | meta_template
  const [message, setMessage] = useState(
    "היי {{GUEST_NAME}} 🌴 יש לנו הצעה בלעדית לחברי המועדון — פרטים בקרוב!",
  );
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("message_templates")
      .select("name, label, content")
      .order("sort_order", { ascending: true });
    if (error) {
      console.warn("[GuestClubBroadcastPanel] templates:", error.message);
      return;
    }
    setTemplates(data ?? []);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  async function runDryRun() {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("guest-club-broadcast", {
        body: {
          channel,
          message,
          waTemplateName: templateName || undefined,
          dry_run: true,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      setLastResult(data);
      onToast?.("ok", `תצוגה מקדימה: ${data.eligible} חברים פעילים ייכללו (עד מגבלת אצווה)`);
    } catch (e) {
      onToast?.("err", e?.message || "שגיאה בתצוגה מקדימה");
    } finally {
      setBusy(false);
    }
  }

  async function runSend() {
    if (busy) return;
    if (channel === "whapi" && !message.trim()) {
      onToast?.("err", "נא לכתוב הודעה לשידור Whapi");
      return;
    }
    if (channel === "meta_template" && !templateName) {
      onToast?.("err", "נא לבחור תבנית Meta");
      return;
    }
    setBusy(true);
    setConfirmOpen(false);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("guest-club-broadcast", {
        body: {
          channel,
          message,
          waTemplateName: templateName || undefined,
          dry_run: false,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      setLastResult(data);
      onToast?.(
        data.failed > 0 ? "err" : "ok",
        `שידור: נשלח ${data.sent} · נכשל ${data.failed} · דולג ${data.skipped}`,
      );
    } catch (e) {
      onToast?.("err", e?.message || "שגיאה בשידור");
    } finally {
      setBusy(false);
    }
  }

  const canSend = activeCount > 0 && !busy;

  return (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 20, borderInlineStart: "4px solid var(--gold-dark)" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--black)", marginBottom: 6 }}>
        📣 שידור הצעות למועדון
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
        רק חברים עם הסכמה פעילה (<strong>{activeCount}</strong>). Whapi = טקסט חופשי.
        Meta = תבנית מאושרת בלבד (מחוץ לחלון 24ש').
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12.5, color: "var(--text-muted)", display: "grid", gap: 4 }}>
          ערוץ
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            style={{
              padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--card-bg)", color: "var(--black)", fontFamily: "inherit",
            }}
          >
            <option value="whapi">📱 Whapi (טקסט חופשי)</option>
            <option value="meta_template">🔵 Meta Template</option>
          </select>
        </label>
      </div>

      {channel === "whapi" ? (
        <label style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
          הודעה (אפשר {"{{GUEST_NAME}}"})
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--black)",
              fontSize: 13.5, fontFamily: "inherit", textAlign: "right", resize: "vertical",
            }}
          />
        </label>
      ) : (
        <label style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
          תבנית Meta מאושרת
          <select
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            style={{
              padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--card-bg)", color: "var(--black)", fontFamily: "inherit",
            }}
          >
            <option value="">— בחרו תבנית —</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.label || t.name}</option>
            ))}
          </select>
        </label>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={busy || activeCount === 0}
          onClick={runDryRun}
          title={activeCount === 0 ? "אין חברי מועדון פעילים" : "ספירה בלי שליחה"}
          style={{
            padding: "10px 14px", borderRadius: 12, border: "1.5px solid var(--border)",
            background: "var(--ivory)", color: "var(--black)", fontWeight: 800,
            cursor: busy || activeCount === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit", fontSize: 13, opacity: busy || activeCount === 0 ? 0.55 : 1,
          }}
        >
          👁️ ספירה מקדימה
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => setConfirmOpen(true)}
          title={activeCount === 0 ? "אין חברי מועדון פעילים" : "שידור אמיתי לחברים"}
          style={{
            padding: "10px 16px", borderRadius: 12, border: "none",
            background: canSend ? "var(--gold-dark)" : "#CFC6B4",
            color: "#fff", fontWeight: 800,
            cursor: canSend ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontSize: 13.5,
          }}
        >
          {busy ? "שולח..." : "🚀 שידור לחברים"}
        </button>
      </div>

      {lastResult && (
        <div style={{
          marginTop: 12, padding: "10px 12px", borderRadius: 10,
          background: "var(--ivory)", border: "1px solid var(--border)",
          fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          {lastResult.dry_run ? (
            <>תצוגה מקדימה: <strong>{lastResult.eligible}</strong> מועמדים · ערוץ {lastResult.channel}</>
          ) : (
            <>נשלח <strong>{lastResult.sent}</strong> · נכשל <strong>{lastResult.failed}</strong> · דולג <strong>{lastResult.skipped}</strong></>
          )}
          {Array.isArray(lastResult.sample) && lastResult.sample.length > 0 && (
            <div style={{ marginTop: 6 }}>
              דוגמה: {lastResult.sample.map((s) => s.name).join(", ")}
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirmOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15,23,42,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 420, background: "var(--card-bg)",
              borderRadius: 16, border: "1px solid var(--border)", padding: 20,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: "var(--black)" }}>
              לאשר שידור למועדון?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16 }}>
              יישלח דרך <strong>{channel === "whapi" ? "Whapi" : "Meta Template"}</strong> עד{" "}
              <strong>{Math.min(80, activeCount)}</strong> חברים פעילים באצווה זו.
              ההודעה תירשם ביומן וב-Inbox.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                disabled={busy}
                onClick={runSend}
                style={{
                  padding: "10px 16px", borderRadius: 12, border: "none",
                  background: "var(--gold-dark)", color: "#fff", fontWeight: 800,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                כן, לשלוח
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)",
                  background: "var(--card-bg)", color: "var(--black)", fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
