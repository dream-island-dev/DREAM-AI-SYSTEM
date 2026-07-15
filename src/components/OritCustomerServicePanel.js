// OritCustomerServicePanel.js — Suite owner CS agent: read-only inbox, AI drafts, manual reply.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const MAILBOX_COLUMNS = [
  "id", "profile_id", "owner_email", "email_address", "provider", "connection_status",
  "read_only_mode", "last_sync_at", "sla_hours", "digest_enabled", "connection_error",
].join(", ");

const URGENCY_META = {
  critical: { label: "🔴 קריטי", bg: "#FEE2E2", color: "#B91C1C" },
  high:     { label: "🟠 דחוף", bg: "#FFEDD5", color: "#C2410C" },
  normal:   { label: "🟢 רגיל", bg: "#ECFDF5", color: "#047857" },
  low:      { label: "⚪ נמוך", bg: "#F3F4F6", color: "#6B7280" },
};

function urgencyMeta(u) {
  return URGENCY_META[u] ?? { label: `⚠ ${u}`, bg: "#F5F5F5", color: "#888" };
}

function fmtDt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function slaLabel(deadlineAt) {
  if (!deadlineAt) return null;
  const ms = new Date(deadlineAt).getTime() - Date.now();
  const hours = Math.round(ms / 3_600_000);
  if (ms < 0) return `עבר SLA (${Math.abs(hours)} ש')`;
  return `נשארו ${hours} ש' ל-72h`;
}

function sortThreads(rows) {
  const rank = { critical: 0, high: 1, normal: 2, low: 3 };
  return [...rows].sort((a, b) => {
    const aOver = a.sla_deadline_at && new Date(a.sla_deadline_at) < new Date();
    const bOver = b.sla_deadline_at && new Date(b.sla_deadline_at) < new Date();
    if (aOver !== bOver) return aOver ? -1 : 1;
    const urg = (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9);
    if (urg !== 0) return urg;
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
  });
}

export default function OritCustomerServicePanel({ user }) {
  const [mailbox, setMailbox] = useState(null);
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showDemo, setShowDemo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((kind, text) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadMailbox = useCallback(async () => {
    if (!isSupabaseConfigured()) return null;
    const { data: rows, error } = await supabase
      .from("orit_agent_mailbox")
      .select(MAILBOX_COLUMNS)
      .order("connection_status", { ascending: true })
      .order("last_sync_at", { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) {
      console.error("[orit-cs] mailbox load:", error);
      showToast("err", error.message);
      return null;
    }
    const data = (rows ?? []).find((m) => m.connection_status === "active") ?? rows?.[0] ?? null;
    if (!data) {
      console.warn("[orit-cs] mailbox row not visible (RLS or missing migration)");
    }
    let next = data;
    if (data?.profile_id == null && user?.id) {
      const userEmail = (user.email || "").toLowerCase();
      const ownsByEmail = userEmail && userEmail === (data?.owner_email || "").toLowerCase();
      const hasAgentAccess = user?.orit_cs_agent_access === true || ownsByEmail;
      if (hasAgentAccess) {
        await supabase.from("orit_agent_mailbox").update({ profile_id: user.id }).eq("id", data.id);
        next = { ...data, profile_id: user.id };
      }
    }
    setMailbox(next);
    return next;
  }, [user?.id, user?.email, user?.orit_cs_agent_access, showToast]);

  const loadThreads = useCallback(async () => {
    if (!mailbox?.id) return;
    let q = supabase
      .from("orit_agent_threads")
      .select("*")
      .eq("mailbox_id", mailbox.id)
      .order("received_at", { ascending: false });
    if (!showDemo) q = q.eq("is_demo", false);
    const { data, error } = await q;
    if (error) {
      showToast("err", error.message);
      return;
    }
    setThreads(sortThreads(data ?? []));
  }, [mailbox?.id, showDemo, showToast]);

  const loadThreadDetail = useCallback(async (threadId) => {
    if (!threadId) {
      setMessages([]);
      setDrafts([]);
      return;
    }
    const [{ data: msgs }, { data: drs }] = await Promise.all([
      supabase.from("orit_agent_messages").select("*").eq("thread_id", threadId).order("received_at", { ascending: true }),
      supabase.from("orit_agent_drafts").select("*").eq("thread_id", threadId).eq("status", "suggested").order("created_at", { ascending: false }),
    ]);
    setMessages(msgs ?? []);
    setDrafts(drs ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadMailbox();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadMailbox]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    loadThreadDetail(selectedId);
  }, [selectedId, loadThreadDetail]);

  useEffect(() => {
    if (!mailbox?.id || !isSupabaseConfigured()) return;
    const ch = supabase
      .channel(`orit-cs-threads-${mailbox.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orit_agent_threads", filter: `mailbox_id=eq.${mailbox.id}` }, () => {
        loadThreads();
        if (selectedId) loadThreadDetail(selectedId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [mailbox?.id, selectedId, loadThreads, loadThreadDetail]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const openCount = threads.filter((t) => t.status === "awaiting_reply").length;

  const handleConnectOutlook = async () => {
    if (!mailbox?.id) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-oauth", {
        body: { mailboxId: mailbox.id },
      });
      if (error) throw error;
      if (data?.status === "not_configured" || data?.error === "missing_client_id") {
        throw new Error("חיבור Microsoft עדיין לא הוגדר בשרת — פנה למייק.");
      }
      if (!data?.authUrl) throw new Error(data?.error || "לא התקבל קישור חיבור");
      const popup = window.open(data.authUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        showToast("err", "הדפדפן חסם חלון קופץ — אשר pop-ups ונסי שוב");
        return;
      }
      showToast("ok", "נפתח חלון Microsoft — התחברי לתיבת 365 ולחצי «מסכים»");
      const onFocus = async () => {
        window.removeEventListener("focus", onFocus);
        await loadMailbox();
        await loadThreads();
      };
      window.addEventListener("focus", onFocus);
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-sync", { body: {} });
      if (error) throw error;
      if (data?.skipped) {
        showToast("err", "סנכרון כבוי בשרת (MANAGER_MAIL_ENABLED)");
        return;
      }
      await loadMailbox();
      await loadThreads();
      const n = data?.synced ?? 0;
      showToast("ok", n > 0 ? `סונכרנו ${n} הודעות חדשות` : "סנכרון הושלם — אין הודעות חדשות");
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-analyze", {
        body: { threadId: selectedId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ניתוח נכשל");
      showToast("ok", "✨ הסוכן עדכן סיכום והצעות");
      await loadThreads();
      await loadThreadDetail(selectedId);
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSnooze = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("orit_agent_threads").update({
        status: "snoozed",
      }).eq("id", selectedId);
      if (error) throw error;
      showToast("ok", "נדחה — תוכלי לחזור אליו מאוחר יותר");
      setSelectedId(null);
      await loadThreads();
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyReply = async (text) => {
    const value = (text ?? replyText).trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setReplyText(value);
      showToast("ok", "הועתק — שלחי את התשובה מ-Outlook שלך");
    } catch {
      showToast("err", "לא ניתן להעתיק — סמני והעתיקי ידנית");
    }
  };

  const handleMarkHandled = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      if (replyText.trim()) {
        const { data, error } = await supabase.functions.invoke("manager-mail-send", {
          body: { threadId: selectedId, bodyText: replyText.trim(), markHandled: true },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "שמירה נכשלה");
        setReplyText("");
      } else {
        const { error } = await supabase.from("orit_agent_threads").update({
          status: "handled",
          handled_at: new Date().toISOString(),
        }).eq("id", selectedId);
        if (error) throw error;
      }
      showToast("ok", "סומן כטופל");
      await loadThreads();
      setSelectedId(null);
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>טוען סוכן שירות לקוחות…</div>;
  }

  if (!mailbox) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#B91C1C", marginBottom: 8 }}>⚠ תיבת הסוכן לא נמצאה</div>
        <div style={{ color: "var(--text-muted)", marginBottom: 16 }}>
          שורת mailbox חסרה או שאין הרשאה (RLS). ודאי ש-migration 155/156 הורצו ושיש גישה ב«ניהול משתמשים».
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setLoading(true); loadMailbox().finally(() => setLoading(false)); }}>
          🔄 נסי שוב
        </button>
      </div>
    );
  }

  const connected = mailbox.connection_status === "active";
  const syncLabel = mailbox.last_sync_at
    ? `סנכרון אחרון: ${fmtDt(mailbox.last_sync_at)}`
    : "ממתין לסנכרון ראשון";

  const needsOAuth = mailbox.provider === "microsoft" && mailbox.connection_status !== "active";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      {toast && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 10,
          background: toast.kind === "err" ? "#FEE2E2" : "#ECFDF5",
          color: toast.kind === "err" ? "#B91C1C" : "#047857",
          fontWeight: 600,
        }}>
          {toast.text}
        </div>
      )}

      <div className="card" style={{ padding: 16, background: "linear-gradient(135deg, #1A1A1A 0%, #2d2418 100%)", color: "#F5F0E8", border: "1px solid var(--gold-dark)" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>👑 סוכן שירות לקוחות — אורית</div>
        <div style={{ opacity: 0.9, marginBottom: 12 }}>
          {openCount > 0
            ? `יש ${openCount} פניות שממתינות לטיפולך`
            : "אין פניות פתוחות כרגע — כל הכבוד!"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{
            padding: "6px 12px",
            borderRadius: 999,
            background: connected ? "#065F4622" : "#F59E0B22",
            color: connected ? "#6EE7B7" : "#FCD34D",
            fontSize: 13,
            fontWeight: 700,
          }}>
            {connected ? "✅ תיבת מייל מסונכרנת" : "⏳ ממתין לחיבור Outlook 365"}
          </span>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{syncLabel}</span>
          {mailbox.email_address && (
            <span style={{ fontSize: 12, opacity: 0.75 }}>{mailbox.email_address}</span>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
            הצג דמו לתרגול
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {needsOAuth && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={handleConnectOutlook}
              style={{ minHeight: 44 }}
              title="חיבור חד-פעמי לתיבת Microsoft 365 שמקבלת את המיילים"
            >
              🔗 חברי תיבת Outlook 365
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy || needsOAuth}
            onClick={handleSyncNow}
            style={{ minHeight: 44 }}
            title={needsOAuth ? "קודם חברי את תיבת Outlook" : "משוך מיילים חדשים עכשיו"}
          >
            🔄 סנכרן עכשיו
          </button>
        </div>
        {!connected && (
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
            {needsOAuth
              ? "לחצי «חברי תיבת Outlook 365» → התחברי ל-orit@triobcom… → מסכים. המיילים מ-dream-island.co.il מגיעים לשם ב-Forward. שליחת תשובות תמיד מ-Outlook שלך."
              : "ממתינה לסנכרון ראשון — לחצי «סנכרן עכשיו»."}
          </div>
        )}
        {connected && (
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
            קראי את הפנייה, לחצי «הצעות תשובה», העתיקי ל-Outlook ושלחי. אחרי שליחה — «שלחתי — סמני כטופל».
          </div>
        )}
        {mailbox.connection_error && (
          <div style={{ marginTop: 10, fontSize: 13, color: "#FCA5A5" }}>
            ⚠ שגיאת חיבור: {mailbox.connection_error}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, minHeight: 480 }}>
        <div className="card" style={{ padding: 12, overflow: "auto", maxHeight: "72vh" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>תור עדיפויות</div>
          {threads.length === 0 && (
            <div style={{ color: "var(--text-muted)", padding: 16, textAlign: "center" }}>אין פניות להצגה</div>
          )}
          {threads.map((t) => {
            const um = urgencyMeta(t.urgency);
            const sla = slaLabel(t.sla_deadline_at);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                style={{
                  width: "100%",
                  textAlign: "right",
                  border: selectedId === t.id ? "2px solid var(--gold)" : "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                  background: selectedId === t.id ? "#FFFBEB" : "var(--card-bg)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: um.bg, color: um.color, fontWeight: 700 }}>
                    {um.label}
                  </span>
                  {t.is_demo && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>דמו</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t.subject || "(ללא נושא)"}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.from_name || t.from_email}</div>
                {sla && (
                  <div style={{ fontSize: 12, marginTop: 6, color: sla.startsWith("עבר") ? "#B91C1C" : "#047857", fontWeight: 600 }}>
                    {sla}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", minHeight: 480 }}>
          {!selected ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              בחרי פנייה מהרשימה
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{selected.subject}</div>
                <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                  {selected.from_name} · {selected.from_email} · {fmtDt(selected.received_at)}
                </div>
                {selected.urgency_reason && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#FEF3C7", fontSize: 14 }}>
                    <strong>למה זה דחוף:</strong> {selected.urgency_reason}
                  </div>
                )}
                {selected.ai_summary && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--ivory)", fontSize: 14 }}>
                    <strong>סיכום הסוכן:</strong> {selected.ai_summary}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12, background: "#FAFAF9" }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ marginBottom: 12, textAlign: m.direction === "outbound" ? "left" : "right" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                      {m.direction === "outbound" ? "יוצא" : "נכנס"} · {m.message_kind} · {fmtDt(m.received_at)}
                    </div>
                    <div style={{
                      display: "inline-block",
                      maxWidth: "90%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: m.direction === "outbound" ? "#DCFCE7" : "#fff",
                      border: "1px solid var(--border)",
                      whiteSpace: "pre-wrap",
                    }}>
                      {m.body_text}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={handleAnalyze} style={{ minHeight: 44 }}>
                  ✨ הצעות תשובה
                </button>
                <button type="button" className="btn" disabled={busy || selected.status === "handled"} onClick={handleMarkHandled} style={{ minHeight: 44 }}>
                  ✅ שלחתי — סמני כטופל
                </button>
                <button type="button" className="btn" disabled={busy} onClick={handleSnooze} style={{ minHeight: 44 }} title="דחי למחר / מאוחר יותר">
                  😴 דחי למחר
                </button>
              </div>

              {drafts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>טיוטות להעתקה ל-Outlook</div>
                  {drafts.map((d) => (
                    <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "#FFFBEB", whiteSpace: "pre-wrap", fontSize: 14 }}>
                        {d.suggested_text}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ minHeight: 40 }}
                          onClick={() => { setReplyText(d.suggested_text); handleCopyReply(d.suggested_text); }}
                        >
                          📋 העתיקי
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ minHeight: 40 }}
                          onClick={() => setReplyText(d.suggested_text)}
                        >
                          ✏️ ערכי לפני העתקה
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="ערכי כאן טיוטה לפני העתקה ל-Outlook…"
                rows={4}
                style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", padding: 12, fontFamily: "Heebo, sans-serif", marginBottom: 10 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !replyText.trim()}
                onClick={() => handleCopyReply()}
                style={{ minHeight: 48, alignSelf: "flex-start" }}
              >
                📋 העתיקי ללוח
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
