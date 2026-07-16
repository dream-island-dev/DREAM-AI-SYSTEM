// OritCustomerServicePanel.js — Orit CS agent: inbox, AI classify, Graph send or copy fallback.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import useIsMobile from "../utils/useIsMobile";
import { isReadOnlyMailbox } from "../utils/oritAgentMail";
import {
  ORIT_CS_TABS,
  threadMatchesTab,
  threadDisplayTitle,
  categoryMeta,
  buildQuickAckText,
} from "../utils/oritAgentClassify";

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
  const isMobile = useIsMobile(768);
  const [mobileScreen, setMobileScreen] = useState("list"); // "list" | "detail"
  const detailHistoryPushedRef = useRef(false);
  const listScrollRef = useRef(null);
  const savedListScrollRef = useRef(0);

  const [mailbox, setMailbox] = useState(null);
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showDemo, setShowDemo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((kind, text) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const [loadError, setLoadError] = useState(null);

  const closeDetail = useCallback(() => {
    setMobileScreen("list");
    setSelectedId(null);
    setReplyText("");
  }, []);

  const goBackToList = useCallback(() => {
    if (isMobile && detailHistoryPushedRef.current && typeof window !== "undefined" && window.history) {
      detailHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    closeDetail();
  }, [isMobile, closeDetail]);

  const openThread = useCallback((threadId) => {
    if (!threadId) return;
    if (isMobile && listScrollRef.current) {
      savedListScrollRef.current = listScrollRef.current.scrollTop;
    }
    setSelectedId(threadId);
    setReplyText("");
    if (isMobile) {
      setMobileScreen("detail");
      if (typeof window !== "undefined" && window.history) {
        window.history.pushState({ oritCsScreen: "detail" }, "");
        detailHistoryPushedRef.current = true;
      }
    }
  }, [isMobile]);

  const loadMailbox = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoadError("Supabase לא מוגדר ב-Vercel — חסרים REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY");
      return null;
    }
    setLoadError(null);

    try {
      const { data: boot, error: bootErr } = await supabase.functions.invoke("orit-cs-bootstrap", {
        body: { includeDemo: showDemo },
      });

      if (bootErr) {
        console.error("[orit-cs] bootstrap error:", bootErr);
        const msg = bootErr.message || "שגיאת רשת בטעינת הסוכן";
        setLoadError(msg);
        showToast("err", msg);
        return null;
      }

      if (!boot?.ok) {
        const msg = boot?.hint || boot?.error || "לא ניתן לטעון את תיבת הסוכן";
        setLoadError(msg);
        return null;
      }

      if (!boot.mailbox) {
        setLoadError("mailbox_not_found בשרת");
        return null;
      }

      setMailbox(boot.mailbox);
      setThreads(sortThreads(boot.threads ?? []));
      return boot.mailbox;
    } catch (e) {
      console.error("[orit-cs] loadMailbox unexpected exception:", e);
      const msg = e?.message ? `שגיאה לא צפויה: ${e.message}` : "שגיאה לא צפויה בטעינת הסוכן";
      setLoadError(msg);
      showToast("err", msg);
      return null;
    }
  }, [showDemo, showToast]);

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
    loadThreadDetail(selectedId);
  }, [selectedId, loadThreadDetail]);

  useEffect(() => {
    if (!mailbox?.id || !isSupabaseConfigured) return;
    const ch = supabase
      .channel(`orit-cs-threads-${mailbox.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orit_agent_threads", filter: `mailbox_id=eq.${mailbox.id}` }, () => {
        loadMailbox();
        if (selectedId) loadThreadDetail(selectedId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [mailbox?.id, selectedId, loadMailbox, loadThreadDetail]);

  useEffect(() => {
    if (!isMobile) return undefined;
    const onPopState = () => {
      detailHistoryPushedRef.current = false;
      closeDetail();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isMobile, closeDetail]);

  useEffect(() => {
    if (isMobile && mobileScreen === "detail" && !selectedId) {
      goBackToList();
    }
  }, [isMobile, mobileScreen, selectedId, goBackToList]);

  useEffect(() => {
    if (isMobile && mobileScreen === "list" && listScrollRef.current) {
      listScrollRef.current.scrollTop = savedListScrollRef.current;
    }
  }, [isMobile, mobileScreen]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const openCount = threads.filter((t) => t.status === "awaiting_reply").length;

  const canSendFromXos = useMemo(
    () => mailbox
      && !isReadOnlyMailbox(mailbox)
      && mailbox.connection_status === "active"
      && mailbox.provider === "microsoft",
    [mailbox],
  );

  const filteredThreads = useMemo(
    () => threads.filter((t) => threadMatchesTab(t, activeTab)),
    [threads, activeTab],
  );

  const tabCounts = useMemo(() => {
    const counts = { all: threads.length, leads: 0, complaints: 0, other: 0 };
    for (const t of threads) {
      const tab = categoryMeta(t.category).tab;
      if (tab in counts) counts[tab] += 1;
    }
    return counts;
  }, [threads]);

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
      await loadMailbox();
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
      goBackToList();
      await loadMailbox();
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
      showToast("ok", canSendFromXos ? "הועתק ללוח" : "הועתק — שלחי את התשובה מ-Outlook שלך");
    } catch {
      showToast("err", "לא ניתן להעתיק — סמני והעתיקי ידנית");
    }
  };

  const handleSendReply = async ({ markHandled = false, text } = {}) => {
    const body = (text ?? replyText).trim();
    if (!body || !selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-send", {
        body: { threadId: selectedId, bodyText: body, markHandled, sendOnly: !markHandled },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.hint || data?.error || "שליחה נכשלה");

      if (data.sent) {
        showToast("ok", markHandled ? "נשלח לאורח וסומן כטופל" : "נשלח לאורח במייל");
        if (markHandled) {
          setReplyText("");
          goBackToList();
        }
      } else {
        await handleCopyReply(body);
        if (markHandled) {
          const { error: updErr } = await supabase.from("orit_agent_threads").update({
            status: "handled",
            handled_at: new Date().toISOString(),
          }).eq("id", selectedId);
          if (updErr) throw updErr;
          setReplyText("");
          goBackToList();
        }
      }
      await loadMailbox();
      if (!markHandled || data.sent) await loadThreadDetail(selectedId);
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleQuickAck = async (sendNow = false) => {
    if (!selected) return;
    const text = buildQuickAckText(selected.from_name);
    setReplyText(text);
    if (sendNow && canSendFromXos) {
      await handleSendReply({ markHandled: false, text });
    }
  };

  const handleMarkHandled = async () => {
    if (!selectedId) return;
    if (replyText.trim() && canSendFromXos) {
      await handleSendReply({ markHandled: true, text: replyText.trim() });
      return;
    }
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
      await loadMailbox();
      goBackToList();
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
          {loadError || "שורת mailbox חסרה או שאין הרשאה (RLS). ודאי שיש גישה ב«ניהול משתמשים»."}
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
  const showHeaderCard = !isMobile || mobileScreen === "list";
  const onDetailMobile = isMobile && mobileScreen === "detail";

  const queuePane = (
    <div
      className="card"
      ref={listScrollRef}
      style={{
        padding: 12,
        overflow: "auto",
        maxHeight: isMobile ? "none" : "72vh",
        flex: isMobile ? 1 : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 10 }}>תור עדיפויות</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {ORIT_CS_TABS.map((tab) => {
          const count = tabCounts[tab.id] ?? 0;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: active ? "2px solid var(--gold)" : "1px solid var(--border)",
                background: active ? "#FFFBEB" : "var(--card-bg)",
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                minHeight: 36,
              }}
            >
              {tab.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
      {filteredThreads.length === 0 && (
        <div style={{ color: "var(--text-muted)", padding: 16, textAlign: "center" }}>אין פניות להצגה</div>
      )}
      {filteredThreads.map((t) => {
        const um = urgencyMeta(t.urgency);
        const cm = categoryMeta(t.category);
        const sla = slaLabel(t.sla_deadline_at);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => openThread(t.id)}
            style={{
              width: "100%",
              textAlign: "right",
              border: selectedId === t.id ? "2px solid var(--gold)" : "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
              background: selectedId === t.id ? "#FFFBEB" : "var(--card-bg)",
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: cm.bg, color: cm.color, fontWeight: 700 }}>
                {cm.label}
              </span>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: um.bg, color: um.color, fontWeight: 700 }}>
                {um.label}
              </span>
              {t.is_demo && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>דמו</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{threadDisplayTitle(t)}</div>
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
  );

  const detailPane = (
    <div
      className="card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        minHeight: isMobile ? 0 : 480,
        flex: isMobile ? 1 : undefined,
        overflow: "hidden",
      }}
    >
      {onDetailMobile && (
        <button
          type="button"
          onClick={goBackToList}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "10px 4px",
            minHeight: 44,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
            fontSize: 15,
            fontWeight: 700,
            color: "var(--gold-dark)",
            alignSelf: "flex-start",
          }}
        >
          <span aria-hidden="true">→</span>
          <span>חזרה לתור</span>
        </button>
      )}
      {!selected ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
          בחרי פנייה מהרשימה
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                background: categoryMeta(selected.category).bg,
                color: categoryMeta(selected.category).color,
                fontWeight: 700,
              }}>
                {categoryMeta(selected.category).label}
              </span>
              <span style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                background: urgencyMeta(selected.urgency).bg,
                color: urgencyMeta(selected.urgency).color,
                fontWeight: 700,
              }}>
                {urgencyMeta(selected.urgency).label}
              </span>
              {selected.auto_ack_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#047857", fontWeight: 600 }}>
                  ✉ אישור קבלה נשלח
                </span>
              )}
            </div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800 }}>{threadDisplayTitle(selected)}</div>
            <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: isMobile ? 13 : 14 }}>
              {selected.from_name} · {selected.from_email} · {fmtDt(selected.received_at)}
            </div>
            {selected.subject && (
              <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 12 }}>
                נושא מייל: {selected.subject}
              </div>
            )}
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

          <div style={{
            flex: 1,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            background: "#FAFAF9",
            minHeight: isMobile ? 120 : undefined,
          }}
          >
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

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, flexShrink: 0 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleAnalyze} style={{ minHeight: 44 }}>
              ✨ הצעות תשובה
            </button>
            {canSendFromXos && (
              <button
                type="button"
                className="btn"
                disabled={busy || !!selected.auto_ack_sent_at}
                onClick={() => handleQuickAck(true)}
                style={{ minHeight: 44 }}
                title="שולח אוטומטית: קיבלנו את בקשתך, ניצור איתך קשר בהקדם"
              >
                📨 אישור קבלה מהיר
              </button>
            )}
            {!canSendFromXos && (
              <button type="button" className="btn" disabled={busy} onClick={() => handleQuickAck(false)} style={{ minHeight: 44 }}>
                📝 הכיני אישור קבלה
              </button>
            )}
            <button type="button" className="btn" disabled={busy || selected.status === "handled"} onClick={handleMarkHandled} style={{ minHeight: 44 }}>
              ✅ שלחתי — סמני כטופל
            </button>
            <button type="button" className="btn" disabled={busy} onClick={handleSnooze} style={{ minHeight: 44 }} title="דחי למחר / מאוחר יותר">
              😴 דחי למחר
            </button>
          </div>

          {drafts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>
                {canSendFromXos ? "טיוטות מוצעות" : "טיוטות להעתקה ל-Outlook"}
              </div>
              {drafts.map((d) => (
                <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "#FFFBEB", whiteSpace: "pre-wrap", fontSize: 14 }}>
                    {d.suggested_text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canSendFromXos && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ minHeight: 44 }}
                        onClick={() => handleSendReply({ markHandled: false, text: d.suggested_text })}
                      >
                        📧 שלחי
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      style={{ minHeight: 44 }}
                      onClick={() => { setReplyText(d.suggested_text); handleCopyReply(d.suggested_text); }}
                    >
                      📋 העתיקי
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ minHeight: 44 }}
                      onClick={() => setReplyText(d.suggested_text)}
                    >
                      ✏️ ערכי לפני שליחה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={canSendFromXos ? "ערכי כאן את התשובה לפני שליחה לאורח…" : "ערכי כאן טיוטה לפני העתקה ל-Outlook…"}
            rows={isMobile ? 3 : 4}
            style={{
              width: "100%",
              borderRadius: 10,
              border: "1px solid var(--border)",
              padding: 12,
              fontFamily: "Heebo, sans-serif",
              marginBottom: 10,
              flexShrink: 0,
              fontSize: 16,
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>
            {canSendFromXos && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !replyText.trim()}
                onClick={() => handleSendReply({ markHandled: false })}
                style={{ minHeight: 48 }}
              >
                📧 שלחי לאורח
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy || !replyText.trim()}
              onClick={() => handleCopyReply()}
              style={{ minHeight: 48 }}
            >
              📋 העתיקי ללוח
            </button>
            {canSendFromXos && (
              <button
                type="button"
                className="btn"
                disabled={busy || !replyText.trim() || selected.status === "handled"}
                onClick={() => handleSendReply({ markHandled: true })}
                style={{ minHeight: 48 }}
              >
                📧 שלחי וסמני כטופל
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 16,
      minHeight: 0,
      height: onDetailMobile ? "calc(100dvh - 140px)" : undefined,
    }}
    >
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

      {showHeaderCard && (
        <div className="card" style={{ padding: 16, background: "linear-gradient(135deg, #1A1A1A 0%, #2d2418 100%)", color: "#F5F0E8", border: "1px solid var(--gold-dark)" }}>
          <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, marginBottom: 6 }}>👑 סוכן שירות לקוחות — אורית</div>
          <div style={{ opacity: 0.9, marginBottom: 12, fontSize: isMobile ? 14 : undefined }}>
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
              <span style={{ fontSize: 12, opacity: 0.75, wordBreak: "break-all" }}>{mailbox.email_address}</span>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", minHeight: 44 }}>
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
          {connected && !isMobile && (
            <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
              {canSendFromXos
                ? "פניות חדשות מקבלות אישור קבלה אוטומטי. בחרי פנייה → «הצעות תשובה» → «שלחי לאורח» או ערכי ידנית."
                : "קראי את הפנייה, לחצי «הצעות תשובה», העתיקי ל-Outlook ושלחי. אחרי שליחה — «שלחתי — סמני כטופל»."}
            </div>
          )}
          {mailbox.connection_error && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#FCA5A5" }}>
              ⚠ שגיאת חיבור: {mailbox.connection_error}
            </div>
          )}
        </div>
      )}

      {isMobile ? (
        mobileScreen === "list" ? queuePane : detailPane
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, minHeight: 480 }}>
          {queuePane}
          {detailPane}
        </div>
      )}
    </div>
  );
}
