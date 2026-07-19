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
  isOritThreadClosed,
  isOritThreadOpen,
} from "../utils/oritAgentClassify";
import {
  oritThreadGuestLabel,
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "../utils/oritGuestContactExtract";
import { sanitizeOritAckDraft } from "../utils/oritAckSanitize";

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

function sortThreads(rows, mode = "recent") {
  if (mode === "priority") {
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

  const statusRank = { awaiting_reply: 0, snoozed: 1, handled: 2, archived: 3 };
  return [...rows].sort((a, b) => {
    const byReceived = new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    if (byReceived !== 0) return byReceived;
    return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
  });
}

function isThreadReceivedToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate()
    && d.getMonth() === now.getMonth()
    && d.getFullYear() === now.getFullYear();
}

function workflowStepMeta(step, thread) {
  const ackDone = Boolean(thread?.auto_ack_sent_at);
  const replyDone = Boolean(thread?.full_reply_sent_at);
  const guestReplied = step === "guest_replied" || thread?.workflow_step === "guest_replied";
  const closed = isOritThreadClosed(thread);
  return {
    ackDone,
    replyDone,
    guestReplied,
    closed,
    shortLabel: closed
      ? "✓ טופל"
      : guestReplied
        ? "📩 אורח השיב"
        : step === "awaiting_ack_approval"
          ? "⏳ אישור קבלה"
          : step === "awaiting_reply_approval"
            ? "✏️ תשובה מלאה"
            : step === "reply_sent"
              ? "ממתין לסגירה"
              : ackDone && !replyDone
                ? "אחרי קבלה"
                : null,
    label: guestReplied
      ? "📩 האורח/ת השיב/ה — ממתינה לתשובה"
      : closed
        ? "✓ הפנייה נסגרה"
        : !ackDone
          ? "⏳ שלב 1: אישור קבלה (72 שעות)"
          : !replyDone
            ? "✏️ שלב 2: תשובה מלאה לאישור"
            : "✅ נשלחה תשובה מלאה — סגרי כשהנושא הסתיים",
  };
}
function fmtReceivedLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.getDate() === now.getDate()
    && d.getMonth() === now.getMonth()
    && d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return `היום ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeWhatsappPhoneInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

export default function OritCustomerServicePanel({ user, onOpenDreamBotChat, focusThreadId = null, onFocusConsumed }) {
  const isMobile = useIsMobile(768);
  const [mobileScreen, setMobileScreen] = useState("list"); // "list" | "detail"
  const detailHistoryPushedRef = useRef(false);
  const listScrollRef = useRef(null);
  const savedListScrollRef = useRef(0);

  const [mailbox, setMailbox] = useState(null);
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [ackText, setAckText] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(true);
  const focusAppliedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [activeTab, setActiveTab] = useState("recent");
  const [queueSort, setQueueSort] = useState("recent");
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
    setAckText("");
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
    setAckText("");
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
        body: {},
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
      setWhatsappPhone(boot.mailbox.digest_whatsapp_phone ?? "");
      setAlertEnabled(boot.mailbox.alert_enabled !== false);
      setThreads(sortThreads(boot.threads ?? [], "recent"));
      return boot.mailbox;
    } catch (e) {
      console.error("[orit-cs] loadMailbox unexpected exception:", e);
      const msg = e?.message ? `שגיאה לא צפויה: ${e.message}` : "שגיאה לא צפויה בטעינת הסוכן";
      setLoadError(msg);
      showToast("err", msg);
      return null;
    }
  }, [showToast]);

  const loadThreadDetail = useCallback(async (threadId) => {
    if (!threadId) {
      setMessages([]);
      setDrafts([]);
      setAckText("");
      return;
    }
    const [{ data: msgs }, { data: drs }] = await Promise.all([
      supabase.from("orit_agent_messages").select("*").eq("thread_id", threadId).order("received_at", { ascending: true }),
      supabase.from("orit_agent_drafts").select("*").eq("thread_id", threadId).in("status", ["suggested", "edited"]).order("created_at", { ascending: false }),
    ]);
    setMessages(msgs ?? []);
    setDrafts(drs ?? []);
    const ackDraft = (drs ?? []).find((d) => d.draft_kind === "ack");
    setAckText(sanitizeOritAckDraft(ackDraft?.final_text || ackDraft?.suggested_text || ""));
    // replyText is filled only when Orit explicitly edits/copies — never auto from draft
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
    if (!focusThreadId || focusAppliedRef.current || !threads.length) return;
    const hit = threads.find((t) => t.id === focusThreadId);
    if (!hit) return;
    focusAppliedRef.current = true;
    openThread(focusThreadId);
    onFocusConsumed?.();
  }, [focusThreadId, threads, openThread, onFocusConsumed]);

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

  useEffect(() => {
    if (!isMobile) return undefined;
    const onDetail = mobileScreen === "detail";
    document.body.classList.toggle("orit-cs-mobile-detail", onDetail);
    return () => { document.body.classList.remove("orit-cs-mobile-detail"); };
  }, [isMobile, mobileScreen]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const ackDraft = useMemo(
    () => drafts.find((d) => d.draft_kind === "ack") ?? null,
    [drafts],
  );

  const fullReplyDraft = useMemo(
    () => drafts.find((d) => d.draft_kind === "full_reply" || !d.draft_kind) ?? null,
    [drafts],
  );

  const workflowMeta = useMemo(
    () => workflowStepMeta(selected?.workflow_step, selected),
    [selected],
  );

  const latestGuestInbound = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].direction === "inbound") return (messages[i].body_text || "").trim();
    }
    return "";
  }, [messages]);

  const hasGuestPhone = Boolean((selected?.guest_contact_phone || "").replace(/\D/g, ""));

  const openCount = threads.filter((t) => isOritThreadOpen(t)).length;
  const handledCount = threads.filter((t) => isOritThreadClosed(t)).length;

  const canSendFromXos = useMemo(
    () => mailbox
      && !isReadOnlyMailbox(mailbox)
      && mailbox.connection_status === "active"
      && mailbox.provider === "microsoft",
    [mailbox],
  );

  const filteredThreads = useMemo(() => {
    const sortMode = activeTab === "complaints" ? "priority" : queueSort;
    const rows = threads.filter((t) => threadMatchesTab(t, activeTab));
    return sortThreads(rows, sortMode);
  }, [threads, activeTab, queueSort]);

  const tabCounts = useMemo(() => {
    const counts = { recent: 0, handled: 0, all: threads.length, leads: 0, complaints: 0, other: 0 };
    for (const t of threads) {
      if (isOritThreadClosed(t)) {
        counts.handled += 1;
        continue;
      }
      counts.recent += 1;
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
      if (data.llm_skipped) {
        showToast("ok", "ליד/שגרתי — סווג בלי AI (חיסכון בקרדיטים). לתלונה: סמני קטגוריה תלונה ונסי שוב.");
      } else {
        showToast("ok", "✨ הסוכן עדכן סיכום וטיוטות בסגנון אורית");
      }
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

  const handleSaveAlertSettings = async () => {
    if (!mailbox?.id) return;
    setBusy(true);
    try {
      const normalized = normalizeWhatsappPhoneInput(whatsappPhone);
      const { error } = await supabase.from("orit_agent_mailbox").update({
        digest_whatsapp_phone: normalized || null,
        alert_enabled: alertEnabled,
      }).eq("id", mailbox.id);
      if (error) throw error;
      setWhatsappPhone(normalized);
      setMailbox((prev) => prev ? {
        ...prev,
        digest_whatsapp_phone: normalized || null,
        alert_enabled: alertEnabled,
      } : prev);
      showToast("ok", "הגדרות סיגל נשמרו");
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendWhapiAlert = async (threadId = selectedId, { force = false } = {}) => {
    if (!threadId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-alert", {
        body: { threadId, force },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "שליחת התראה נכשלה");
      if (data.sent) {
        showToast("ok", "📱 סיגל שלחה התראה לוואטסאפ של אורית");
      } else {
        const reasonMsg = data.reason === "no_phone"
          ? "חסר מספר וואטסאפ — שמרי למטה"
          : data.reason === "not_complaint"
            ? "וואטסאפ לאורית — רק לתלונות (לא לידים)"
            : `לא נשלח: ${data.reason || "לא ידוע"}`;
        showToast("err", reasonMsg);
      }
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

  const handleSendReply = async ({ markHandled = false, text, draftKind = "full_reply", draftId } = {}) => {
    const body = (text ?? replyText).trim();
    if (!body || !selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-send", {
        body: {
          threadId: selectedId,
          bodyText: body,
          markHandled,
          sendOnly: !markHandled,
          draftKind,
          draftId: draftId ?? (draftKind === "ack" ? ackDraft?.id : fullReplyDraft?.id),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.hint || data?.error || "שליחה נכשלה");

      if (data.sent) {
        const targetEmail = selected ? resolveOritReplyEmail(selected.from_email, selected.guest_contact_email) : "";
        const phaseLabel = draftKind === "ack" ? "אישור קבלה נשלח" : "תשובה מלאה נשלחה";
        const sentLabel = targetEmail ? `${phaseLabel} ל־${targetEmail}` : `${phaseLabel} לאורח במייל`;
        const ackFollowUp = draftKind === "ack" ? " — שלב 2 מוכן לעריכה" : "";
        showToast("ok", markHandled ? `${sentLabel} וסומן כטופל` : `${sentLabel}${ackFollowUp}`);
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
            workflow_step: null,
            orit_chat_pending: null,
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

  const handleSendViaSuitesDevice = async ({ text, draftKind = "full_reply", draftId } = {}) => {
    const body = (text ?? replyText).trim();
    if (!body || !selectedId || !hasGuestPhone) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-send", {
        body: {
          threadId: selectedId,
          bodyText: body,
          channel: "whatsapp_bridge",
          draftKind,
          draftId: draftId ?? (draftKind === "ack" ? ackDraft?.id : fullReplyDraft?.id),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.hint || data?.error || "שליחה בוואטסאפ נכשלה");

      showToast("ok", "📱 נשלחה הודעה לאורח במכשיר הסוויטות");
      await loadMailbox();
      await loadThreadDetail(selectedId);
      if (data.inboxLink && onOpenDreamBotChat) {
        onOpenDreamBotChat?.({
          phone: selected.guest_contact_phone,
          guestName: resolveOritReplyName(selected.from_name, selected.guest_contact_name),
          inboxChannel: "whapi",
        });
      }
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendAck = async () => {
    const body = ackText.trim();
    if (!body || !selectedId) return;
    await handleSendReply({ markHandled: false, text: body, draftKind: "ack", draftId: ackDraft?.id });
  };

  const handleQuickAck = async (sendNow = false) => {
    if (!selected) return;
    const text = buildQuickAckText(resolveOritReplyName(selected.from_name, selected.guest_contact_name));
    setReplyText(text);
    if (sendNow && canSendFromXos) {
      await handleSendReply({ markHandled: false, text });
    }
  };

  const handleMarkHandled = async () => {
    if (!selectedId) return;
    if (replyText.trim()) {
      const ok = window.confirm(
        "הפנייה תסומן כטופלת בלי לשלוח מייל מהמערכת.\nהמייל כבר נשלח?",
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("orit_agent_threads").update({
        status: "handled",
        handled_at: new Date().toISOString(),
        workflow_step: null,
        orit_chat_pending: null,
      }).eq("id", selectedId);
      if (error) throw error;
      setReplyText("");
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
      <div style={{ fontWeight: 700, marginBottom: 10 }}>תור פניות — מיון לפי זמן קבלה למערכת</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>מיון:</span>
        <button
          type="button"
          onClick={() => setQueueSort("recent")}
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: queueSort === "recent" ? "2px solid var(--gold)" : "1px solid var(--border)",
            background: queueSort === "recent" ? "#FFFBEB" : "var(--card-bg)",
            fontSize: 12,
            fontWeight: queueSort === "recent" ? 700 : 500,
            cursor: "pointer",
          }}
        >
          🕐 אחרונים קודם
        </button>
        <button
          type="button"
          onClick={() => setQueueSort("priority")}
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: queueSort === "priority" ? "2px solid var(--gold)" : "1px solid var(--border)",
            background: queueSort === "priority" ? "#FFFBEB" : "var(--card-bg)",
            fontSize: 12,
            fontWeight: queueSort === "priority" ? 700 : 500,
            cursor: "pointer",
          }}
        >
          ⚡ לפי דחיפות
        </button>
        {activeTab === "complaints" && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>תלונות: מיון דחיפות אוטומטי</span>
        )}
      </div>
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
        const closed = isOritThreadClosed(t);
        const wf = workflowStepMeta(t.workflow_step, t);
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
              background: selectedId === t.id
                ? "#FFFBEB"
                : closed
                  ? "#F9FAFB"
                  : "var(--card-bg)",
              opacity: closed ? 0.82 : 1,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: cm.bg, color: cm.color, fontWeight: 700 }}>
                {cm.label}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {closed && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#E5E7EB", color: "#374151", fontWeight: 700 }}>
                    ✓ טופל{t.handled_at ? ` · ${fmtDt(t.handled_at)}` : ""}
                  </span>
                )}
                {!closed && wf.shortLabel && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#FEF3C7", color: "#92400E", fontWeight: 700 }}>
                    {wf.shortLabel}
                  </span>
                )}
                {!closed && isThreadReceivedToday(t.received_at) && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#DBEAFE", color: "#1D4ED8", fontWeight: 700 }}>
                    חדש היום
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                  📥 {fmtReceivedLabel(t.received_at)}
                </span>
                <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: um.bg, color: um.color, fontWeight: 700 }}>
                  {um.label}
                </span>
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: closed ? "var(--text-muted)" : undefined }}>
              {threadDisplayTitle(t)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{oritThreadGuestLabel(t)}</div>
            {!closed && sla && (
              <div style={{ fontSize: 12, marginTop: 6, color: sla.startsWith("עבר") ? "#B91C1C" : "#047857", fontWeight: 600 }}>
                {sla}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  const detailScrollable = isMobile && mobileScreen === "detail";

  const detailPane = (
    <div
      className="card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        minHeight: detailScrollable ? undefined : 480,
        flex: isMobile && !detailScrollable ? 1 : undefined,
        overflow: detailScrollable ? "visible" : "hidden",
        paddingBottom: detailScrollable ? "calc(var(--safe-bottom-nav, 80px) + 12px)" : 16,
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
            background: "var(--card-bg)",
            cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
            fontSize: 15,
            fontWeight: 700,
            color: "var(--gold-dark)",
            alignSelf: "flex-start",
            position: "sticky",
            top: 0,
            zIndex: 2,
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
              {selected.category === "complaint" && !workflowMeta.closed && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#EDE9FE", color: "#5B21B6", fontWeight: 600 }}>
                  {workflowMeta.label}
                </span>
              )}
              {workflowMeta.closed && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#E5E7EB", color: "#374151", fontWeight: 700 }}>
                  ✓ טופל · {selected.handled_at ? fmtDt(selected.handled_at) : "—"}
                </span>
              )}
              {selected.full_reply_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#047857", fontWeight: 600 }}>
                  ✉ תשובה מלאה נשלחה · {fmtDt(selected.full_reply_sent_at)}
                </span>
              )}
              {selected.auto_ack_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#047857", fontWeight: 600 }}>
                  ✉ אישור קבלה · {fmtDt(selected.auto_ack_sent_at)}
                </span>
              )}
              {selected.workflow_step === "awaiting_ack_approval" && !selected.auto_ack_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#FEF3C7", color: "#92400E", fontWeight: 600 }}>
                  ⏳ ממתינה לאישור — סיגל ב-WA: «תראי לי» / «אשרי» → «כן שלחי»
                </span>
              )}
            </div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800 }}>{threadDisplayTitle(selected)}</div>
            <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: isMobile ? 13 : 14 }}>
              {oritThreadGuestLabel(selected)} · {fmtDt(selected.received_at)}
            </div>
            {(selected.guest_contact_email || selected.guest_contact_phone || selected.guest_contact_name) && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#EFF6FF", fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>פרטי אורח מהפנייה</div>
                {selected.guest_contact_name && <div>שם: {selected.guest_contact_name}</div>}
                {selected.guest_contact_email && (
                  <div>מייל: {selected.guest_contact_email}</div>
                )}
                {selected.guest_contact_phone && (
                  <div>טלפון: {selected.guest_contact_phone}</div>
                )}
                <div style={{ marginTop: 6, color: "#1D4ED8", fontWeight: 600 }}>
                  שליחת מייל תגיע ל: {resolveOritReplyEmail(selected.from_email, selected.guest_contact_email) || "⚠ אין מייל אורח — רק וואטסאפ/ידני"}
                </div>
              </div>
            )}
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
            {selected.category === "complaint" && (selected.urgency === "high" || selected.urgency === "critical") && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#F5F3FF", fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>מסלול טיפול</div>
                <div>{workflowMeta.ackDone ? "✅" : "①"} אישור קבלה (72 שעות)</div>
                <div>{workflowMeta.replyDone ? "✅" : "②"} תשובה מלאה לאורח/ת</div>
                <div>{workflowMeta.guestReplied ? "📩" : "③"} מעקב תשובת אורח</div>
              </div>
            )}
          </div>

          {workflowMeta.guestReplied && !workflowMeta.closed && (
            <div style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              background: "#FEF3C7",
              border: "2px solid #F59E0B",
              flexShrink: 0,
            }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 15 }}>📩 האורח/ת השיב/ה למייל</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: latestGuestInbound ? 8 : 0 }}>
                סיגל שלחה לך עדכון בוואטסאפ עם טיוטת המשך. ערכי ושלחי במייל או במכשיר הסוויטות.
              </div>
              {latestGuestInbound && (
                <div style={{
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  background: "#fff",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #FCD34D",
                  maxHeight: 120,
                  overflow: "auto",
                }}
                >
                  {latestGuestInbound.length > 500 ? `${latestGuestInbound.slice(0, 500)}…` : latestGuestInbound}
                </div>
              )}
            </div>
          )}

          <div style={{
            flex: detailScrollable ? undefined : 1,
            overflow: detailScrollable ? "visible" : "auto",
            WebkitOverflowScrolling: detailScrollable ? undefined : "touch",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            background: "#FAFAF9",
            minHeight: detailScrollable ? undefined : (isMobile ? 120 : undefined),
          }}
          >
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 12, textAlign: m.direction === "outbound" ? "left" : "right" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                  {m.direction === "outbound" ? "יוצא" : "נכנס"}
                  {m.external_key?.startsWith?.("wa-") ? " · 📱 מכשיר סוויטות" : ""}
                  {" · "}{m.message_kind} · {fmtDt(m.received_at)}
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
            <button
              type="button"
              className="btn"
              disabled={busy || selected.status === "handled" || selected.category !== "complaint" || !["high", "critical"].includes(selected.urgency)}
              onClick={() => handleSendWhapiAlert(selected.id, { force: true })}
              style={{ minHeight: 44 }}
              title={selected.category !== "complaint"
                ? "וואטסאפ לאורית — רק לתלונות"
                : !["high", "critical"].includes(selected.urgency)
                  ? "התראת וואטסאפ — תלונות דחופות/קריטיות בלבד"
                  : "שליחת התראה לסיגל בוואטסאפ עם טיוטת אישור קבלה"}
            >
              📱 התראה לסיגל (וואטסאפ)
            </button>
            {canSendFromXos && (
              <button
                type="button"
                className="btn"
                disabled={busy || !!selected.auto_ack_sent_at || !resolveOritReplyEmail(selected.from_email, selected.guest_contact_email)}
                onClick={() => handleQuickAck(true)}
                style={{ minHeight: 44 }}
                title="שליחה ידנית לאורח — רק למייל שחולץ מהפנייה (לא כתובת הממסר)"
              >
                📨 אישור קבלה ידני (מייל)
              </button>
            )}
            {!canSendFromXos && (
              <button type="button" className="btn" disabled={busy} onClick={() => handleQuickAck(false)} style={{ minHeight: 44 }}>
                📝 הכיני אישור קבלה
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy || selected.status === "handled"}
              onClick={handleMarkHandled}
              style={{ minHeight: 44 }}
              title="סימון בלבד — מסונכרן עם סיגל בוואטסאפ («סיימתי»)"
            >
              ✓ סיימתי — סמן כטופל
            </button>
            <button type="button" className="btn" disabled={busy} onClick={handleSnooze} style={{ minHeight: 44 }} title="דחי למחר / מאוחר יותר">
              😴 דחי למחר
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !hasGuestPhone || !onOpenDreamBotChat}
              onClick={() => onOpenDreamBotChat?.({
                phone: selected.guest_contact_phone,
                guestName: resolveOritReplyName(selected.from_name, selected.guest_contact_name),
                inboxChannel: "whapi",
              })}
              style={{ minHeight: 44 }}
              title={selected.guest_contact_phone
                ? "פתיחת שיחת וואטסאפ באינבוקס (מכשיר הסוויטות)"
                : "לא זוהה טלפון בגוף הפנייה"}
            >
              💬 וואטסאפ באינבוקס
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !hasGuestPhone || (!replyText.trim() && !fullReplyDraft?.suggested_text && !ackText.trim())}
              onClick={() => handleSendViaSuitesDevice({
                text: replyText.trim() || fullReplyDraft?.suggested_text || ackText,
                draftKind: !selected.auto_ack_sent_at && ackText.trim() ? "ack" : "full_reply",
              })}
              style={{ minHeight: 44 }}
              title={hasGuestPhone
                ? "שליחת הטיוטה לאורח במכשיר הסוויטות (לא מחליפה מייל רשמי)"
                : "חסר טלפון אורח בפנייה"}
            >
              📱 שלח דרך מכשיר הסוויטות
            </button>
          </div>

          {!selected.auto_ack_sent_at && (ackDraft || ackText) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                שלב 1 — אישור קבלה (72 שעות)
              </div>
              <textarea
                value={ackText}
                onChange={(e) => setAckText(e.target.value)}
                placeholder="ערכי את אישור הקבלה לפני שליחה…"
                rows={isMobile ? 4 : 5}
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #FCD34D",
                  padding: 12,
                  fontSize: 14,
                  lineHeight: 1.5,
                  background: "#FFFBEB",
                }}
              />
              {canSendFromXos && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !ackText.trim() || !resolveOritReplyEmail(selected.from_email, selected.guest_contact_email)}
                  onClick={handleSendAck}
                  style={{ minHeight: 44 }}
                >
                  ✉ אשרי ושלחי אישור קבלה
                </button>
              )}
            </div>
          )}

          {selected.auto_ack_sent_at && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>
                שלב 2 — תשובה מלאה לאורח/ת
              </div>
              {!replyText.trim() && fullReplyDraft?.suggested_text && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "#FFFBEB", whiteSpace: "pre-wrap", fontSize: 14 }}>
                    {fullReplyDraft.suggested_text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canSendFromXos && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || selected.status === "handled"}
                        onClick={() => handleSendReply({
                          markHandled: false,
                          text: fullReplyDraft.suggested_text,
                          draftKind: "full_reply",
                          draftId: fullReplyDraft.id,
                        })}
                        style={{ minHeight: 44 }}
                      >
                        📧 שלחי מ-XOS
                      </button>
                    )}
                    {hasGuestPhone && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || selected.status === "handled"}
                        onClick={() => handleSendViaSuitesDevice({
                          text: fullReplyDraft.suggested_text,
                          draftKind: "full_reply",
                          draftId: fullReplyDraft.id,
                        })}
                        style={{ minHeight: 44 }}
                      >
                        📱 שלח דרך מכשיר הסוויטות
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => { setReplyText(fullReplyDraft.suggested_text); handleCopyReply(fullReplyDraft.suggested_text); }}
                      style={{ minHeight: 44 }}
                    >
                      📋 העתיקי
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setReplyText(fullReplyDraft.suggested_text)}
                      style={{ minHeight: 44 }}
                    >
                      ✏️ ערכי לפני שליחה
                    </button>
                  </div>
                </div>
              )}
              {(replyText.trim() || !fullReplyDraft?.suggested_text) && (
                <>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={canSendFromXos ? "ערכי כאן את התשובה המלאה לפני שליחה לאורח…" : "ערכי כאן טיוטה לפני העתקה ל-Outlook…"}
                    rows={isMobile ? 6 : 8}
                    style={{
                      width: "100%",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      padding: 12,
                      fontSize: 14,
                      lineHeight: 1.5,
                      background: "#FFFBEB",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canSendFromXos && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !replyText.trim() || selected.status === "handled"}
                        onClick={() => handleSendReply({ markHandled: false, text: replyText, draftKind: "full_reply", draftId: fullReplyDraft?.id })}
                        style={{ minHeight: 44 }}
                      >
                        ✉ אשרי ושלחי תשובה (סיגל תעדכן עד «סיימתי»)
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !replyText.trim()}
                      onClick={() => handleCopyReply(replyText)}
                      style={{ minHeight: 44 }}
                    >
                      📋 העתיקי
                    </button>
                    {hasGuestPhone && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !replyText.trim() || selected.status === "handled"}
                        onClick={() => handleSendViaSuitesDevice({
                          text: replyText,
                          draftKind: "full_reply",
                          draftId: fullReplyDraft?.id,
                        })}
                        style={{ minHeight: 44 }}
                      >
                        📱 שלח דרך מכשיר הסוויטות
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {!selected.auto_ack_sent_at && !ackDraft && drafts.length > 0 && (
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
                        📧 שלחי מ-XOS
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

          {!(selected.category === "complaint" && ["high", "critical"].includes(selected.urgency)) && (
          <>
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
                📧 שלחי מ-XOS
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
            {hasGuestPhone && (
              <button
                type="button"
                className="btn"
                disabled={busy || !replyText.trim() || selected.status === "handled"}
                onClick={() => handleSendViaSuitesDevice({ text: replyText, draftKind: "full_reply" })}
                style={{ minHeight: 48 }}
              >
                📱 שלח דרך מכשיר הסוויטות
              </button>
            )}
            {canSendFromXos && (
              <button
                type="button"
                className="btn"
                disabled={busy || !replyText.trim() || selected.status === "handled"}
                onClick={() => handleSendReply({ markHandled: true })}
                style={{ minHeight: 48 }}
              >
                📧 שלחי מ-XOS וסמן כטופל
              </button>
            )}
          </div>
          </>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 16,
      minHeight: onDetailMobile ? undefined : 0,
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
              : handledCount > 0
                ? `אין פניות פתוחות — ${handledCount} טופלו (טאב «טופלו»)`
                : "אין פניות כרגע"}
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
          </div>
          <div style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(212,175,55,0.25)",
          }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📱 סיגל → וואטסאפ של אורית</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <label style={{ flex: "1 1 200px", fontSize: 12 }}>
                <span style={{ display: "block", marginBottom: 4, opacity: 0.85 }}>מספר וואטסאפ</span>
                <input
                  type="tel"
                  className="input"
                  dir="ltr"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="0504056101"
                  style={{ width: "100%", minHeight: 40 }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", minHeight: 40 }}>
                <input
                  type="checkbox"
                  checked={alertEnabled}
                  onChange={(e) => setAlertEnabled(e.target.checked)}
                />
                התראות דחופות
              </label>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={handleSaveAlertSettings}
                style={{ minHeight: 40 }}
              >
                💾 שמרי
              </button>
            </div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>
              תלונות ופניות דחופות — Whapi מיידי עם קישור. בוקר 06:30: תלונות פתוחות + לידים ב-24ש&apos;.
            </div>
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
                ? "טאב «פתוחות» = תור פעיל. אחרי שליחה — «סיימתי — סמן כטופל» (מסונכרן עם סיגל). טופלו עובר לטאב «טופלו»; מייל חדש מאורח פותח מחדש + התראה."
                : "טאב «פתוחות» = תור פעיל. אחרי שליחה מ-Outlook — «סיימתי — סמן כטופל». טופלו בטאב «טופלו»."}
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
