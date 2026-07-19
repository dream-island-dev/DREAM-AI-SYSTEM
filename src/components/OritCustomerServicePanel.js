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
  isOritThreadClosed,
  isOritThreadOpen,
} from "../utils/oritAgentClassify";
import {
  oritThreadGuestLabel,
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "../utils/oritGuestContactExtract";
import { sanitizeOritAckDraft } from "../utils/oritAckSanitize";
import {
  defaultOritScheduleLocalInput,
  formatOritScheduleLabel,
  isOritQuietHours,
  localInputToIso,
  ORIT_QUIET_HOURS_HINT,
} from "../utils/oritScheduleUi";

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

const BUBBLE_PREVIEW_MAX = 480;
const SUGGESTION_PREVIEW_MAX = 420;

function messageBubbleMeta(m) {
  const wa = m.external_key?.startsWith?.("wa-");
  const channel = wa ? "📱" : "📧";
  const who = m.direction === "outbound" ? "אורית" : "אורח/ת";
  return `${who} · ${channel} · ${fmtDt(m.received_at)}`;
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
  const autoAnalyzeRef = useRef(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState({});
  const [expandedSuggestions, setExpandedSuggestions] = useState({});
  const [activeTab, setActiveTab] = useState("recent");
  const [queueSort, setQueueSort] = useState("recent");
  const [toast, setToast] = useState(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(() => isOritQuietHours());
  const [scheduleAt, setScheduleAt] = useState(() => defaultOritScheduleLocalInput());
  const [pendingSchedule, setPendingSchedule] = useState(null);

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
      setPendingSchedule(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    try {
      const [{ data: msgs }, { data: drs }, { data: sched }] = await Promise.all([
        supabase.from("orit_agent_messages").select("*").eq("thread_id", threadId).order("received_at", { ascending: true }),
        supabase.from("orit_agent_drafts").select("*").eq("thread_id", threadId).in("status", ["suggested", "edited"]).order("created_at", { ascending: false }),
        supabase.from("orit_agent_scheduled_sends").select("*").eq("thread_id", threadId).eq("status", "pending").order("scheduled_for", { ascending: true }).limit(1).maybeSingle(),
      ]);
      setMessages(msgs ?? []);
      setDrafts(drs ?? []);
      setPendingSchedule(sched ?? null);
      const ackDraftRow = (drs ?? []).find((d) => d.draft_kind === "ack");
      setAckText(sanitizeOritAckDraft(ackDraftRow?.final_text || ackDraftRow?.suggested_text || ""));
      // replyText is filled only when Orit explicitly edits/copies — never auto from draft
    } finally {
      setDetailLoading(false);
    }
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
    setExpandedMessages({});
    setExpandedSuggestions({});
    setDetailsExpanded(false);
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

  const fullReplyDrafts = useMemo(
    () => drafts.filter((d) => d.draft_kind === "full_reply" || !d.draft_kind),
    [drafts],
  );

  const fullReplyDraft = useMemo(
    () => fullReplyDrafts[0] ?? null,
    [fullReplyDrafts],
  );

  const workflowMeta = useMemo(
    () => workflowStepMeta(selected?.workflow_step, selected),
    [selected],
  );

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

  const composePhase = useMemo(() => {
    if (!selected?.auto_ack_sent_at) return "ack";
    return "full_reply";
  }, [selected?.auto_ack_sent_at]);

  const composeSuggestions = useMemo(() => {
    if (composePhase === "ack") {
      return ackDraft ? [ackDraft] : [];
    }
    return fullReplyDrafts;
  }, [composePhase, ackDraft, fullReplyDrafts]);

  const composeText = composePhase === "ack" ? ackText : replyText;
  const setComposeText = composePhase === "ack" ? setAckText : setReplyText;

  const composePlaceholder = composePhase === "ack"
    ? "אישור קבלה לאורח/ת — ערכי ושלחי…"
    : canSendFromXos
      ? "תשובה לאורח/ת — ערכי ושלחי…"
      : "טיוטה לפני העתקה ל-Outlook…";

  const loadDraftToCompose = useCallback((draft) => {
    const target = draft || (composePhase === "ack" ? ackDraft : fullReplyDraft);
    if (!target?.suggested_text) return;
    if (composePhase === "ack") {
      setAckText(sanitizeOritAckDraft(target.suggested_text));
      return;
    }
    setReplyText(target.suggested_text);
  }, [composePhase, ackDraft, fullReplyDraft]);

  const toggleSuggestionExpanded = useCallback((draftId) => {
    setExpandedSuggestions((prev) => ({ ...prev, [draftId]: !prev[draftId] }));
  }, []);

  const toggleMessageExpanded = useCallback((msgId) => {
    setExpandedMessages((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  }, []);

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

  const runThreadAnalyze = useCallback(async ({ silent = false, forceLlm = true } = {}) => {
    if (!selectedId) return false;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-analyze", {
        body: { threadId: selectedId, forceLlm },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ניתוח נכשל");
      if (data.llm_skipped) {
        if (!silent) {
          showToast("ok", "ליד/שגרתי — סווג בלי AI (חיסכון בקרדיטים). לתלונה: סמני קטגוריה תלונה ונסי שוב.");
        }
      } else {
        if (!silent) {
          showToast("ok", "✨ הסוכן עדכן סיכום וטיוטות בסגנון אורית");
        } else {
          showToast("ok", "✨ הוכנו הצעות AI בממשק");
        }
        const phase = selected?.auto_ack_sent_at ? "full_reply" : "ack";
        const suggestions = Array.isArray(data.analysis?.suggestions) ? data.analysis.suggestions : [];
        if (phase === "full_reply" && suggestions[0] && !replyText.trim()) {
          setReplyText(suggestions[0]);
        } else if (phase === "ack" && data.analysis?.ackSuggestion && !ackText.trim()) {
          setAckText(sanitizeOritAckDraft(data.analysis.ackSuggestion));
        }
      }
      await loadMailbox();
      await loadThreadDetail(selectedId);
      return true;
    } catch (e) {
      if (!silent) showToast("err", e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [selectedId, selected, replyText, ackText, loadMailbox, loadThreadDetail, showToast]);

  const handleAnalyze = () => runThreadAnalyze({ silent: false, forceLlm: true });

  useEffect(() => {
    if (!focusThreadId || selectedId !== focusThreadId) return;
    if (!selected || isOritThreadClosed(selected)) return;
    if (loading || detailLoading || busy) return;
    if (autoAnalyzeRef.current === selectedId) return;

    const needsAckDraft = !selected.auto_ack_sent_at;
    const hasDrafts = needsAckDraft
      ? drafts.some((d) => d.draft_kind === "ack")
      : drafts.some((d) => d.draft_kind === "full_reply" || !d.draft_kind);

    autoAnalyzeRef.current = selectedId;
    if (hasDrafts) return;

    runThreadAnalyze({
      silent: true,
      forceLlm: selected.category === "complaint",
    });
  }, [
    focusThreadId,
    selectedId,
    selected,
    drafts,
    loading,
    detailLoading,
    busy,
    runThreadAnalyze,
  ]);

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

  useEffect(() => {
    if (isOritQuietHours()) {
      setScheduleEnabled(true);
      setScheduleAt(defaultOritScheduleLocalInput());
    }
  }, [selectedId]);

  const handleCancelSchedule = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manager-mail-send", {
        body: { threadId: selectedId, cancelSchedule: true },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.hint || data?.error || "ביטול נכשל");
      setPendingSchedule(null);
      showToast("ok", "התזמון בוטל");
      await loadThreadDetail(selectedId);
    } catch (e) {
      showToast("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendReply = async ({
    markHandled = false,
    text,
    draftKind = "full_reply",
    draftId,
    viaWhatsapp = false,
  } = {}) => {
    const body = (text ?? replyText).trim();
    if (!body || !selectedId) return;
    const scheduledIso = scheduleEnabled ? localInputToIso(scheduleAt) : null;
    if (scheduleEnabled && !scheduledIso) {
      showToast("err", "שעת תזמון לא תקינה");
      return;
    }
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
          ...(viaWhatsapp ? { channel: "whatsapp_bridge" } : {}),
          ...(scheduledIso ? { scheduledFor: scheduledIso } : {}),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.hint || data?.error || "שליחה נכשלה");

      if (data.scheduled) {
        const when = formatOritScheduleLabel(data.scheduledFor);
        const dest = viaWhatsapp ? "בוואטסאפ" : "במייל";
        showToast("ok", `📅 מתוזמן ל${when} (${dest}) — סיגל תעדכן`);
        await loadThreadDetail(selectedId);
        return;
      }

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
      if (viaWhatsapp && data.sent && data.inboxLink && onOpenDreamBotChat && selected) {
        onOpenDreamBotChat?.({
          phone: selected.guest_contact_phone,
          guestName: resolveOritReplyName(selected.from_name, selected.guest_contact_name),
          inboxChannel: "whapi",
        });
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
    await handleSendReply({
      markHandled: false,
      text: body,
      draftKind,
      draftId: draftId ?? (draftKind === "ack" ? ackDraft?.id : fullReplyDraft?.id),
      viaWhatsapp: true,
    });
  };

  const handleSendAck = async () => {
    const body = ackText.trim();
    if (!body || !selectedId) return;
    await handleSendReply({ markHandled: false, text: body, draftKind: "ack", draftId: ackDraft?.id });
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
        maxHeight: detailScrollable ? undefined : "85vh",
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
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" }}>
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
              {selected.auto_ack_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#047857", fontWeight: 600 }}>
                  ✉ אישור קבלה
                </span>
              )}
              {selected.full_reply_sent_at && (
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#047857", fontWeight: 600 }}>
                  ✉ תשובה נשלחה
                </span>
              )}
              <button
                type="button"
                onClick={() => setDetailsExpanded((v) => !v)}
                style={{
                  marginRight: "auto",
                  border: "1px solid var(--border)",
                  background: "#fff",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                {detailsExpanded ? "הסתירי פרטים ▲" : "פרטי פנייה ▼"}
              </button>
            </div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800 }}>{threadDisplayTitle(selected)}</div>
            <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: isMobile ? 13 : 14 }}>
              {oritThreadGuestLabel(selected)} · {fmtDt(selected.received_at)}
            </div>
            {detailsExpanded && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {(selected.guest_contact_email || selected.guest_contact_phone || selected.guest_contact_name) && (
                  <div style={{ padding: 10, borderRadius: 8, background: "#EFF6FF", fontSize: 13, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>פרטי אורח</div>
                    {selected.guest_contact_name && <div>שם: {selected.guest_contact_name}</div>}
                    {selected.guest_contact_email && <div>מייל: {selected.guest_contact_email}</div>}
                    {selected.guest_contact_phone && <div>טלפון: {selected.guest_contact_phone}</div>}
                    <div style={{ marginTop: 6, color: "#1D4ED8", fontWeight: 600 }}>
                      שליחת מייל ל: {resolveOritReplyEmail(selected.from_email, selected.guest_contact_email) || "⚠ אין מייל — רק וואטסאפ"}
                    </div>
                  </div>
                )}
                {selected.subject && (
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>נושא: {selected.subject}</div>
                )}
                {selected.urgency_reason && (
                  <div style={{ padding: 10, borderRadius: 8, background: "#FEF3C7", fontSize: 13 }}>
                    <strong>למה דחוף:</strong> {selected.urgency_reason}
                  </div>
                )}
                {selected.ai_summary && (
                  <div style={{ padding: 10, borderRadius: 8, background: "var(--ivory)", fontSize: 13 }}>
                    <strong>סיכום:</strong> {selected.ai_summary}
                  </div>
                )}
                {selected.category === "complaint" && (selected.urgency === "high" || selected.urgency === "critical") && (
                  <div style={{ padding: 10, borderRadius: 8, background: "#F5F3FF", fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>מסלול טיפול</div>
                    <div>{workflowMeta.ackDone ? "✅" : "①"} אישור קבלה · {workflowMeta.replyDone ? "✅" : "②"} תשובה מלאה · {workflowMeta.guestReplied ? "📩" : "③"} מעקב אורח</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{
            flex: detailScrollable ? undefined : 1,
            overflow: detailScrollable ? "visible" : "auto",
            WebkitOverflowScrolling: detailScrollable ? undefined : "touch",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
            background: "#FAFAF9",
            minHeight: detailScrollable ? undefined : (isMobile ? 120 : 160),
          }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 14 }}>
                אין הודעות עדיין
              </div>
            )}
            {messages.map((m) => {
              const body = m.body_text || "";
              const isLong = body.length > BUBBLE_PREVIEW_MAX;
              const expanded = expandedMessages[m.id];
              const shown = isLong && !expanded ? `${body.slice(0, BUBBLE_PREVIEW_MAX)}…` : body;
              return (
                <div key={m.id} style={{ marginBottom: 12, textAlign: m.direction === "outbound" ? "left" : "right" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                    {messageBubbleMeta(m)}
                  </div>
                  <div style={{
                    display: "inline-block",
                    maxWidth: "90%",
                    padding: "10px 12px",
                    borderRadius: m.direction === "outbound" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                    background: m.direction === "outbound" ? "#DCFCE7" : "#fff",
                    border: "1px solid var(--border)",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                    lineHeight: 1.5,
                    textAlign: "right",
                  }}>
                    {shown}
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleMessageExpanded(m.id)}
                        style={{
                          display: "block",
                          marginTop: 6,
                          border: "none",
                          background: "transparent",
                          color: "#1D4ED8",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                          padding: 0,
                          fontFamily: "Heebo, sans-serif",
                        }}
                      >
                        {expanded ? "הציגי פחות" : "הציגי הכל"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!workflowMeta.closed && (
            <div style={{
              flexShrink: 0,
              borderTop: "2px solid var(--border)",
              paddingTop: 10,
              background: "#fff",
              position: detailScrollable ? "sticky" : undefined,
              bottom: detailScrollable ? "calc(var(--safe-bottom-nav, 80px) + 8px)" : undefined,
              zIndex: detailScrollable ? 2 : undefined,
            }}
            >
              {pendingSchedule && (
                <div style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#EFF6FF",
                  border: "1px solid #93C5FD",
                  fontSize: 13,
                  lineHeight: 1.4,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
                >
                  <span>
                    📅 מתוזמן ל{formatOritScheduleLabel(pendingSchedule.scheduled_for)}
                    {" · "}
                    {pendingSchedule.channel === "whatsapp_bridge" ? "וואטסאפ" : "מייל"}
                  </span>
                  <button type="button" className="btn" disabled={busy} onClick={handleCancelSchedule} style={{ minHeight: 32, fontSize: 12 }}>
                    בטלי תזמון
                  </button>
                </div>
              )}

              {workflowMeta.guestReplied && (
                <div style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#FEF3C7",
                  border: "1px solid #F59E0B",
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
                >
                  <strong>📩 האורח/ת השיב/ה</strong> — ערכי ושלחי המשך למטה
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: composePhase === "ack" ? "#92400E" : "#1D4ED8", marginBottom: 6 }}>
                {composePhase === "ack" ? "אישור קבלה (שלב 1)" : "תשובה לאורח/ת"}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={handleAnalyze} style={{ minHeight: 36, fontSize: 13 }}>
                  ✨ הצעות
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || selected.category !== "complaint" || !["high", "critical"].includes(selected.urgency)}
                  onClick={() => handleSendWhapiAlert(selected.id, { force: true })}
                  style={{ minHeight: 36, fontSize: 13 }}
                  title="התראה לסיגל בוואטסאפ"
                >
                  📱 סיגל
                </button>
                {(composePhase === "ack" ? ackDraft?.suggested_text : fullReplyDraft?.suggested_text) && (
                  <button type="button" className="btn" disabled={busy} onClick={() => loadDraftToCompose()} style={{ minHeight: 36, fontSize: 13 }}>
                    📝 טעני טיוטה
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={busy || selected.status === "handled"}
                  onClick={handleMarkHandled}
                  style={{ minHeight: 36, fontSize: 13 }}
                >
                  ✓ סיימתי
                </button>
                <button type="button" className="btn" disabled={busy} onClick={handleSnooze} style={{ minHeight: 36, fontSize: 13 }}>
                  😴 דחי
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
                  style={{ minHeight: 36, fontSize: 13 }}
                >
                  💬 אינבוקס
                </button>
              </div>

              {composeSuggestions.length > 0 && (
                <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                    ✨ הצעות AI ({composeSuggestions.length})
                    {composeSuggestions.length > 1 ? " — בחרי וריאנט" : ""}
                  </div>
                  {composeSuggestions.map((draft, index) => {
                    const text = draft.suggested_text || "";
                    const expanded = expandedSuggestions[draft.id];
                    const needsExpand = text.length > SUGGESTION_PREVIEW_MAX;
                    const preview = expanded || !needsExpand
                      ? text
                      : `${text.slice(0, SUGGESTION_PREVIEW_MAX)}…`;
                    const variantLabel = composeSuggestions.length > 1
                      ? (index === 0 ? "הצעה מומלצת" : `וריאנט ${index + 1}`)
                      : "הצעה";
                    return (
                      <div
                        key={draft.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          background: index === 0 ? "#FFFBEB" : "#F9FAFB",
                          padding: 10,
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 6 }}>
                          {variantLabel}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5, marginBottom: 8 }}>
                          {preview}
                        </div>
                        {needsExpand && (
                          <button
                            type="button"
                            onClick={() => toggleSuggestionExpanded(draft.id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#1D4ED8",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              padding: 0,
                              marginBottom: 8,
                              fontFamily: "Heebo, sans-serif",
                            }}
                          >
                            {expanded ? "הצג פחות ▲" : "הצג הכל ▼"}
                          </button>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => loadDraftToCompose(draft)}
                            style={{ minHeight: 36, fontSize: 13 }}
                          >
                            ✏️ ערכי
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => handleCopyReply(text)}
                            style={{ minHeight: 36, fontSize: 13 }}
                          >
                            📋 העתקי
                          </button>
                          {canSendFromXos && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={
                                busy
                                || selected.status === "handled"
                                || (composePhase === "ack" && !resolveOritReplyEmail(selected.from_email, selected.guest_contact_email))
                              }
                              onClick={() => {
                                if (composePhase === "ack") {
                                  handleSendReply({
                                    markHandled: false,
                                    text,
                                    draftKind: "ack",
                                    draftId: draft.id,
                                  });
                                } else {
                                  handleSendReply({
                                    markHandled: false,
                                    text,
                                    draftKind: "full_reply",
                                    draftId: draft.id,
                                  });
                                }
                              }}
                              style={{ minHeight: 36, fontSize: 13 }}
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
                                text,
                                draftKind: composePhase === "ack" ? "ack" : "full_reply",
                                draftId: draft.id,
                              })}
                              style={{ minHeight: 36, fontSize: 13 }}
                            >
                              📱 שלח בסוויטות
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder={composePlaceholder}
                rows={isMobile ? 3 : 4}
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: composePhase === "ack" ? "1px solid #FCD34D" : "1px solid var(--border)",
                  padding: 12,
                  fontSize: 15,
                  lineHeight: 1.5,
                  background: "#FFFBEB",
                  fontFamily: "Heebo, sans-serif",
                  marginBottom: 8,
                  resize: "vertical",
                }}
              />

              <div style={{
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 8,
                background: scheduleEnabled ? "#F0F9FF" : "#F9FAFB",
                border: `1px solid ${scheduleEnabled ? "#7DD3FC" : "var(--border)"}`,
              }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: scheduleEnabled ? 8 : 0 }}>
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    disabled={busy || Boolean(pendingSchedule)}
                  />
                  ⏰ שליחה מתוזמנת
                  {isOritQuietHours() && (
                    <span style={{ fontSize: 11, color: "#0369A1" }}>(מומלץ עכשיו)</span>
                  )}
                </label>
                {scheduleEnabled && (
                  <div>
                    <input
                      type="datetime-local"
                      className="input"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      disabled={busy || Boolean(pendingSchedule)}
                      style={{ width: "100%", maxWidth: 280, minHeight: 40 }}
                    />
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {ORIT_QUIET_HOURS_HINT}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {canSendFromXos && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy
                      || !composeText.trim()
                      || (composePhase === "ack" && !resolveOritReplyEmail(selected.from_email, selected.guest_contact_email))
                      || (composePhase === "full_reply" && selected.status === "handled")
                    }
                    onClick={() => {
                      if (composePhase === "ack") {
                        handleSendAck();
                      } else {
                        handleSendReply({
                          markHandled: false,
                          text: composeText,
                          draftKind: "full_reply",
                          draftId: fullReplyDraft?.id,
                        });
                      }
                    }}
                    style={{ minHeight: 44, flex: isMobile ? "1 1 100%" : undefined }}
                  >
                    {scheduleEnabled ? "📅 תזמני מייל" : "📧 שלחי מ-XOS"}
                  </button>
                )}
                {hasGuestPhone && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !composeText.trim() || selected.status === "handled"}
                    onClick={() => handleSendViaSuitesDevice({
                      text: composeText,
                      draftKind: composePhase === "ack" ? "ack" : "full_reply",
                      draftId: composePhase === "ack" ? ackDraft?.id : fullReplyDraft?.id,
                    })}
                    style={{ minHeight: 44, flex: isMobile ? "1 1 100%" : undefined }}
                  >
                    {scheduleEnabled ? "📅 תזמן בוואטסאפ" : "📱 שלח בסוויטות"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !composeText.trim()}
                  onClick={() => handleCopyReply(composeText)}
                  style={{ minHeight: 44 }}
                >
                  📋 העתקה
                </button>
                {canSendFromXos && composePhase === "full_reply" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !composeText.trim() || selected.status === "handled"}
                    onClick={() => handleSendReply({
                      markHandled: true,
                      text: composeText,
                      draftKind: "full_reply",
                      draftId: fullReplyDraft?.id,
                    })}
                    style={{ minHeight: 44 }}
                  >
                    {scheduleEnabled ? "📅 תזמני וסמני טופל" : "📧 שלחי וסמני טופל"}
                  </button>
                )}
              </div>
            </div>
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
