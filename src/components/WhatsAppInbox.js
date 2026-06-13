// src/components/WhatsAppInbox.js
// Dream Island — WhatsApp Conversation Inbox
// Two-panel UI: contact list (right) + message thread (left, RTL)
// Real-time updates via Supabase Realtime

import React, { useEffect, useState, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const POLL_MS = 2500; // fallback polling interval

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function groupByPhone(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.phone)) {
      map.set(row.phone, {
        phone: row.phone,
        guestName: row.guest_name,
        messages: [],
        humanRequested: false,
        humanRequestType: null,
      });
    }
    const contact = map.get(row.phone);
    contact.messages.push(row);
    // Flag contact if any inbound message is a human request
    if (row.human_requested && row.direction === "inbound") {
      contact.humanRequested = true;
      if (row.human_request_type && !contact.humanRequestType) {
        contact.humanRequestType = row.human_request_type;
      }
    }
  }
  // Human-requested contacts first, then by latest message desc
  return [...map.values()].sort((a, b) => {
    if (a.humanRequested !== b.humanRequested) return a.humanRequested ? -1 : 1;
    const aLast = a.messages[a.messages.length - 1]?.created_at ?? "";
    const bLast = b.messages[b.messages.length - 1]?.created_at ?? "";
    return bLast.localeCompare(aLast);
  });
}

// ── Contact list item ────────────────────────────────────────────────────────
function ContactItem({ contact, isActive, onClick }) {
  const last  = contact.messages[contact.messages.length - 1];
  const unread = contact.messages.filter(
    (m) => m.direction === "inbound" && !m._read
  ).length;

  const waPhone = contact.phone.replace(/^\+/, "");
  const humanLabel = contact.humanRequestType === "call"
    ? "🔴 מבקש שיחת טלפון"
    : "🔴 מבקש מענה אנושי";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 16px",
        cursor: "pointer",
        borderBottom: "1px solid #f0f0f0",
        background: contact.humanRequested
          ? (isActive ? "#ffdfdf" : "#FFF0F0")
          : (isActive ? "#e8f4fd" : "white"),
        borderRight: contact.humanRequested
          ? "4px solid #ef4444"
          : isActive ? "4px solid #25D366" : "4px solid transparent",
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Avatar */}
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: contact.humanRequested ? "#ef4444" : "#25D366",
            color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 16, flexShrink: 0,
          }}>
            {(contact.guestName ?? contact.phone)?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a" }}>
              {contact.guestName ?? contact.phone}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {contact.guestName ? contact.phone : ""}
            </div>
          </div>
        </div>
        {/* Right side: WA button + time + unread */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <a
              href={`https://wa.me/${waPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="פתח שיחת וואטסאפ"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, borderRadius: "50%",
                background: "#25D366", color: "white",
                fontSize: 13, textDecoration: "none", flexShrink: 0,
              }}
            >
              💬
            </a>
            <div style={{ fontSize: 11, color: "#aaa" }}>{formatTime(last?.created_at)}</div>
          </div>
          {unread > 0 && (
            <div style={{
              background: "#25D366", color: "white",
              borderRadius: 12, fontSize: 11, fontWeight: 700,
              padding: "1px 7px", display: "inline-block",
            }}>
              {unread}
            </div>
          )}
        </div>
      </div>
      {last && (
        <div style={{
          fontSize: 12, color: "#666", marginTop: 6,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          paddingRight: 48,
        }}>
          {last.direction === "outbound" ? "✓ " : ""}{last.message}
        </div>
      )}
      {contact.humanRequested && (
        <div style={{
          marginTop: 6, display: "inline-block",
          background: "#FEE2E2", color: "#DC2626",
          fontSize: 11, fontWeight: 700,
          padding: "2px 8px", borderRadius: 10,
          border: "1px solid #FECACA",
        }}>
          {humanLabel}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg }) {
  const isOut = msg.direction === "outbound";
  return (
    <div style={{
      display: "flex",
      justifyContent: isOut ? "flex-start" : "flex-end",
      marginBottom: 4,
    }}>
      <div style={{
        maxWidth: "72%",
        background: isOut ? "#dcf8c6" : "#ffffff",
        border: isOut ? "none" : "1.5px solid #c5d9f0",
        borderRadius: isOut ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        boxShadow: isOut ? "0 1px 2px rgba(0,0,0,0.08)" : "0 1px 4px rgba(55,138,221,0.12)",
        padding: "8px 12px",
        fontSize: 14,
        color: "#1a1a1a",
        lineHeight: 1.5,
        wordBreak: "break-word",
      }}>
        {msg.message}
        <div style={{
          fontSize: 10, color: "#aaa", marginTop: 4,
          textAlign: isOut ? "left" : "right",
        }}>
          {formatTime(msg.created_at)}
          {isOut && <span style={{ marginRight: 4 }}>✓✓</span>}
        </div>
      </div>
    </div>
  );
}

// ── Quick marketing phrases ───────────────────────────────────────────────────
const QUICK_PHRASES = [
  { label: "ברוכים הבאים 🌴", text: "שלום {{שם}}! ברוכים הבאים ל-Dream Island. אנחנו שמחים לארח אתכם — אם יש משהו שנוכל לעשות כדי שהחופשה תהיה מושלמת, אנחנו כאן! 🏖️" },
  { label: "חדר מוכן ✅", text: "שלום {{שם}}, חדרכם מוכן ומחכה לכם 🎉 ניתן להיכנס מ-15:00. צוות הקבלה שלנו ישמח לקבל אתכם!" },
  { label: "צ׳ק-אאוט מחר ⏰", text: "שלום {{שם}}, תזכורת ידידותית — הצ׳ק-אאוט שלכם מחר בשעה 11:00. אם תרצו לאחר יציאה, נשמח לנסות לסדר. 😊" },
  { label: "הצעת ספא 💆", text: "שלום {{שם}}, יש לנו מתנה קטנה בשבילכם — 20% הנחה על טיפולי הספא שלנו לאורח בית! מוזמנים לתאם: 📞" },
  { label: "שאלון שביעות רצון ⭐", text: "שלום {{שם}}, תודה שבחרתם ב-Dream Island! נשמח לשמוע כיצד הייתה שהייתכם — דירוג קטן של 1–5 יסייע לנו להשתפר 🙏" },
  { label: "הצעה מיוחדת 🎁", text: "שלום {{שם}}, כאורחים מיוחדים שלנו — יש לנו הצעה בלעדית רק בשבילכם! צרו קשר ונספר לכם 😍" },
];

// ── New Conversation Modal ────────────────────────────────────────────────────
function NewChatModal({ onClose, onSent }) {
  const [mode,          setMode]          = useState("free"); // "free" | "template"
  const [guestSearch,   setGuestSearch]   = useState("");
  const [guestResults,  setGuestResults]  = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);

  // Template mode
  const [waTemplates,   setWaTemplates]   = useState([]);
  const [dbTemplates,   setDbTemplates]   = useState([]);
  const [loadingTmpls,  setLoadingTmpls]  = useState(false);
  const [selectedTmpl,  setSelectedTmpl]  = useState(null);
  const [varValues,     setVarValues]     = useState([]);

  // Free-text mode
  const [freeText,      setFreeText]      = useState("");

  const [sending,       setSending]       = useState(false);
  const [err,           setErr]           = useState(null);
  const [hoveredPhrase, setHoveredPhrase] = useState(null);
  const [hoveredTmpl,   setHoveredTmpl]   = useState(null);

  // Bulk mode
  const [bulkFilter,    setBulkFilter]    = useState("checked_in"); // "all"|"checked_in"|"expected"|"suite"|"day_guest"|"checkout_today"
  const [bulkGuests,    setBulkGuests]    = useState([]);
  const [bulkText,      setBulkText]      = useState("");
  const [bulkSending,   setBulkSending]   = useState(false);
  const [bulkProgress,  setBulkProgress]  = useState(null); // { done, total }
  const [bulkDone,      setBulkDone]      = useState(false);
  const [showBulkList,  setShowBulkList]  = useState(false);

  // Template audience mode
  const [tmplMode,           setTmplMode]           = useState("single"); // "single"|"audience"
  const [tmplAudienceFilter, setTmplAudienceFilter] = useState("checked_in");
  const [tmplAudienceGuests, setTmplAudienceGuests] = useState([]);
  const [tmplBulkSending,    setTmplBulkSending]    = useState(false);
  const [tmplBulkProgress,   setTmplBulkProgress]   = useState(null);
  const [tmplBulkDone,       setTmplBulkDone]       = useState(false);

  // Load guests for bulk mode whenever filter changes
  useEffect(() => {
    if (mode !== "bulk" || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from("guests").select("id, name, phone, room, room_type, arrival_date, status").not("phone", "is", null);
    if (bulkFilter === "checked_in")      q = q.eq("status", "checked_in");
    else if (bulkFilter === "expected")   q = q.eq("status", "expected");
    else if (bulkFilter === "suite")      q = q.eq("room_type", "suite");
    else if (bulkFilter === "day_guest")  q = q.eq("room_type", "day_guest");
    else if (bulkFilter === "checkout_today") q = q.eq("status", "checked_in").lte("departure_date", today);
    q.limit(200).then(({ data }) => setBulkGuests((data ?? []).filter((g) => g.phone)));
  }, [mode, bulkFilter]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function handleSendBulk() {
    if (!bulkText.trim())        return setErr("נא לכתוב הודעה");
    if (bulkGuests.length === 0) return setErr("אין נמענים בסינון הנוכחי");

    setBulkSending(true); setErr(null); setBulkDone(false);
    let done = 0;
    for (const g of bulkGuests) {
      setBulkProgress({ done, total: bulkGuests.length });
      const personalised = bulkText.replace(/{{שם}}/g, g.name ?? "").replace(/\{\{שם\}\}/g, g.name ?? "");
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "inbox_reply", phone: g.phone, message: personalised },
        });
        if (!error && data?.ok) {
          await supabase.from("whatsapp_conversations").insert({
            phone: g.phone, direction: "outbound", message: personalised, wa_message_id: null,
          });
        }
      } catch (_) { /* skip failed individual sends */ }
      done++;
      await sleep(650); // rate-limit: ~90 msgs/min
    }
    setBulkProgress({ done, total: bulkGuests.length });
    setBulkSending(false);
    setBulkDone(true);
  }

  // Fetch WA templates + DB templates on mount
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingTmpls(true);

    Promise.all([
      supabase.functions.invoke("get-wa-templates").then(({ data }) => data?.templates ?? []),
      supabase.from("message_templates").select("*").order("sort_order").then(({ data }) => data ?? []),
    ]).then(([wa, db]) => {
      // Only show APPROVED Meta templates; exclude hello_world (test-number only)
      const approvedWa = wa.filter(
        (w) =>
          w.name !== "hello_world" &&
          (w.status == null || String(w.status).toUpperCase() === "APPROVED")
      );
      setWaTemplates(approvedWa);
      setDbTemplates(db);
    }).finally(() => setLoadingTmpls(false));
  }, []);

  // Search guests by name or phone
  useEffect(() => {
    if (!guestSearch.trim() || !supabase) { setGuestResults([]); return; }
    const q = guestSearch.trim();
    supabase
      .from("guests")
      .select("id, name, phone, room, room_type, arrival_date, status")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8)
      .then(({ data }) => setGuestResults(data ?? []));
  }, [guestSearch]);

  function pickTemplate(tmpl) {
    setSelectedTmpl(tmpl);
    setVarValues(tmpl ? Array(tmpl.varCount ?? 0).fill("") : []);
  }

  function insertPhrase(text) {
    const personalised = selectedGuest
      ? text.replace("{{שם}}", selectedGuest.name ?? "")
      : text;
    setFreeText(personalised);
  }

  // ── Free-text send (inbox_reply — works within 24h service window) ──────────
  async function handleSendFree() {
    if (!selectedGuest)       return setErr("נא לבחור אורח");
    if (!selectedGuest.phone) return setErr("לאורח זה אין מספר טלפון");
    if (!freeText.trim())     return setErr("נא לכתוב הודעה");

    setSending(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "inbox_reply", phone: selectedGuest.phone, message: freeText.trim() },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "שגיאה בשליחה");
      if (data && !data.ok) throw new Error(data.error ?? "שגיאה בשליחה");

      await supabase.from("whatsapp_conversations").insert({
        phone: selectedGuest.phone, direction: "outbound",
        message: freeText.trim(), wa_message_id: null,
      });
      onSent(selectedGuest.phone, data?.simulation);
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  // ── Template send ───────────────────────────────────────────────────────────
  async function handleSendTemplate() {
    if (!selectedGuest)       return setErr("נא לבחור אורח");
    if (!selectedGuest.phone) return setErr("לאורח זה אין מספר טלפון");
    if (!selectedTmpl)        return setErr("נא לבחור תבנית");
    if ((selectedTmpl.varCount ?? 0) > 0 && varValues.some((v) => !v.trim()))
      return setErr("נא למלא את כל שדות המשתנים");

    setSending(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger:           "broadcast",
          guestId:           selectedGuest.id,
          waTemplateName:    selectedTmpl.name,
          templateVariables: varValues,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");

      await supabase.from("whatsapp_conversations").insert({
        phone: selectedGuest.phone, direction: "outbound",
        message: `[תבנית: ${selectedTmpl.name}]`, wa_message_id: null,
      });
      onSent(selectedGuest.phone, data.simulation);
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  // Load guests for template audience mode
  useEffect(() => {
    if (mode !== "template" || tmplMode !== "audience" || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from("guests").select("id, name, phone, room, room_type, arrival_date, status").not("phone", "is", null);
    if (tmplAudienceFilter === "checked_in")      q = q.eq("status", "checked_in");
    else if (tmplAudienceFilter === "expected")   q = q.eq("status", "expected");
    else if (tmplAudienceFilter === "arriving_today") q = q.eq("arrival_date", today);
    else if (tmplAudienceFilter === "suite")      q = q.eq("room_type", "suite");
    else if (tmplAudienceFilter === "past")       q = q.eq("status", "checked_out");
    q.limit(200).then(({ data }) => setTmplAudienceGuests((data ?? []).filter((g) => g.phone)));
  }, [mode, tmplMode, tmplAudienceFilter]);

  // ── Template audience bulk send ─────────────────────────────────────────────
  async function handleSendTemplateAudience() {
    if (!selectedTmpl)              return setErr("נא לבחור תבנית");
    if (tmplAudienceGuests.length === 0) return setErr("אין נמענים בסינון הנוכחי");

    setTmplBulkSending(true); setErr(null); setTmplBulkDone(false);
    let done = 0;
    for (const g of tmplAudienceGuests) {
      setTmplBulkProgress({ done, total: tmplAudienceGuests.length });
      try {
        const autoVars = varValues.map((v, idx) => {
          if (v.trim()) return v;
          if (idx === 0) return g.name ?? "";
          if (idx === 1) return g.room ?? "";
          if (idx === 2) return g.arrival_date ?? "";
          return "";
        });
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "broadcast", guestId: g.id, waTemplateName: selectedTmpl.name, templateVariables: autoVars },
        });
        if (!error && data?.ok) {
          await supabase.from("whatsapp_conversations").insert({
            phone: g.phone, direction: "outbound", message: `[תבנית: ${selectedTmpl.name}]`, wa_message_id: null,
          });
        }
      } catch (_) {}
      done++;
      await sleep(650);
    }
    setTmplBulkProgress({ done, total: tmplAudienceGuests.length });
    setTmplBulkSending(false);
    setTmplBulkDone(true);
  }

  // Build live preview text (template with vars substituted)
  function buildPreview() {
    if (!selectedTmpl?.bodyText) return null;
    let text = selectedTmpl.bodyText;
    varValues.forEach((v, i) => { text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), v || `{{${i + 1}}}`); });
    return text;
  }

  const VAR_LABELS = ["שם אורח", "מספר חדר", "תאריך הגעה", "סוג חדר", "שעת הגעה"];
  const allTmpls   = [
    ...dbTemplates.map((d) => ({
      name:     d.label ?? d.name ?? d.title ?? d.template_name ?? "(ללא שם)",
      bodyText: d.body_text ?? d.content ?? d.message ?? d.text ?? "",
      varCount: (d.body_text ?? d.content ?? d.text ?? "").match(/\{\{\d+\}\}/g)?.length ?? 0,
      source: "db",
      emoji:    d.emoji ?? "📋",
      category: d.category ?? "",
    })),
    ...waTemplates.map((w) => ({ ...w, source: "wa", emoji: "✅" })),
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "white", borderRadius: 18, width: 520, maxWidth: "96vw",
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
        direction: "rtl",
      }} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg, #075E54 0%, #128C7E 100%)",
          color: "white", padding: "18px 22px", borderRadius: "18px 18px 0 0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>✉️ הודעה חדשה</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>שיווק ושימור לקוחות</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
            color: "white", fontSize: 16, cursor: "pointer", borderRadius: 8,
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Guest search (hidden when template audience mode) ── */}
          <div style={{ display: mode === "template" && tmplMode === "audience" ? "none" : "block" }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 12, marginBottom: 6, color: "#555", textTransform: "uppercase", letterSpacing: 0.5 }}>
              👤 נמען
            </label>
            {selectedGuest ? (
              <div style={{
                padding: "12px 16px", borderRadius: 12,
                background: "linear-gradient(135deg, #E8F5EF, #F0FAF5)",
                border: "1.5px solid #25D366",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", background: "#25D366",
                    color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 16, flexShrink: 0,
                  }}>
                    {selectedGuest.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a1a" }}>{selectedGuest.name}</div>
                    <div style={{ fontSize: 12, color: "#555", direction: "ltr", marginTop: 1 }}>{selectedGuest.phone}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      {selectedGuest.room && (
                        <span style={{ background: "#E0F2FE", color: "#0369A1", fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600 }}>
                          🏨 חדר {selectedGuest.room}
                        </span>
                      )}
                      {selectedGuest.arrival_date && (
                        <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600 }}>
                          📅 {selectedGuest.arrival_date}
                        </span>
                      )}
                      {selectedGuest.status && (
                        <span style={{
                          background: selectedGuest.status === "checked_in" ? "#D1FAE5" : "#F3F4F6",
                          color: selectedGuest.status === "checked_in" ? "#065F46" : "#6B7280",
                          fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600,
                        }}>
                          {selectedGuest.status === "checked_in" ? "✅ שוהה" : "🕐 מתוכנן"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => { setSelectedGuest(null); setGuestSearch(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 18, lineHeight: 1, paddingTop: 2 }}>
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type="text" value={guestSearch}
                  onChange={(e) => setGuestSearch(e.target.value)}
                  placeholder="חפש לפי שם או מספר טלפון..."
                  autoFocus
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "11px 16px", borderRadius: 12, fontSize: 14,
                    border: "1.5px solid #ddd", outline: "none", direction: "rtl",
                    fontFamily: "inherit", transition: "border 0.2s",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#25D366"}
                  onBlur={(e) => e.target.style.borderColor = "#ddd"}
                />
                {guestResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", right: 0, left: 0, zIndex: 20,
                    background: "white", border: "1.5px solid #ddd", borderRadius: "0 0 12px 12px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
                  }}>
                    {guestResults.map((g) => (
                      <div key={g.id}
                        onClick={() => { setSelectedGuest(g); setGuestSearch(""); setGuestResults([]); }}
                        style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f0faf5"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700 }}>{g.name}</span>
                          <span style={{ color: "#888", direction: "ltr", fontSize: 12 }}>{g.phone ?? "ללא טלפון"}</span>
                        </div>
                        {(g.room || g.arrival_date) && (
                          <div style={{ marginTop: 3, display: "flex", gap: 6 }}>
                            {g.room && <span style={{ background: "#E0F2FE", color: "#0369A1", fontSize: 10, padding: "1px 5px", borderRadius: 4 }}>חדר {g.room}</span>}
                            {g.arrival_date && <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 10, padding: "1px 5px", borderRadius: 4 }}>{g.arrival_date}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Mode tabs ── */}
          <div style={{
            display: "flex", background: "#F3F4F6", borderRadius: 12, padding: 4, gap: 2,
          }}>
            {[
              { id: "free",     label: "✍️ יחיד" },
              { id: "template", label: "📋 תבנית" },
              { id: "bulk",     label: "📢 קבוצתי" },
            ].map((tab) => (
              <button key={tab.id} onClick={() => { setMode(tab.id); setErr(null); }}
                style={{
                  flex: 1, padding: "9px 0", border: "none", borderRadius: 9,
                  fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  transition: "all 0.2s",
                  background: mode === tab.id ? "white" : "transparent",
                  color: mode === tab.id ? "#075E54" : "#6B7280",
                  boxShadow: mode === tab.id ? "0 1px 6px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── FREE TEXT TAB ── */}
          {mode === "free" && (
            <>
              {/* Quick phrases */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  ⚡ ביטויים מהירים
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_PHRASES.map((ph, i) => (
                    <button key={i}
                      onClick={() => insertPhrase(ph.text)}
                      onMouseEnter={() => setHoveredPhrase(i)}
                      onMouseLeave={() => setHoveredPhrase(null)}
                      style={{
                        padding: "6px 12px", borderRadius: 20, border: "1.5px solid",
                        borderColor: hoveredPhrase === i ? "#075E54" : "#E0D5C5",
                        background: hoveredPhrase === i ? "#E8F5EF" : "#FAFAFA",
                        color: hoveredPhrase === i ? "#075E54" : "#444",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  💬 תוכן ההודעה
                </div>
                <div style={{ position: "relative" }}>
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value.slice(0, 1000))}
                    placeholder="כתוב הודעה... או לחץ על ביטוי מהיר למעלה"
                    rows={5}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "12px 16px", paddingBottom: 30,
                      borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                      border: "1.5px solid #ddd", outline: "none",
                      fontFamily: "inherit", direction: "rtl", resize: "vertical",
                      background: "#FAFAFA", transition: "border 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#25D366"}
                    onBlur={(e) => e.target.style.borderColor = "#ddd"}
                  />
                  <div style={{
                    position: "absolute", bottom: 10, left: 12,
                    fontSize: 11, color: freeText.length > 900 ? "#DC2626" : "#aaa",
                  }}>
                    {freeText.length}/1000
                  </div>
                </div>
                <div style={{
                  marginTop: 6, fontSize: 11, color: "#888",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span>⚠️</span>
                  <span>שליחה חופשית אפשרית בתוך חלון 24 שעות לאחר הודעת הלקוח</span>
                </div>
              </div>

              {/* Live preview */}
              {freeText.trim() && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    👁️ תצוגה מקדימה
                  </div>
                  <div style={{
                    background: "#DCF8C6", borderRadius: "18px 18px 4px 18px",
                    padding: "10px 14px", fontSize: 13, lineHeight: 1.6,
                    color: "#1a1a1a", maxWidth: "85%", wordBreak: "break-word",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)", direction: "rtl",
                  }}>
                    {freeText}
                    <div style={{ fontSize: 10, color: "#666", marginTop: 4, textAlign: "left" }}>✓✓ עכשיו</div>
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              <button onClick={handleSendFree} disabled={sending || !selectedGuest || !freeText.trim()}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: sending || !selectedGuest || !freeText.trim()
                    ? "#E5E7EB"
                    : "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
                  color: sending || !selectedGuest || !freeText.trim() ? "#9CA3AF" : "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                  cursor: sending || !selectedGuest || !freeText.trim() ? "not-allowed" : "pointer",
                  transition: "all 0.2s", letterSpacing: 0.3,
                }}
              >
                {sending ? "⏳ שולח..." : "📤 שלח הודעה"}
              </button>
            </>
          )}

          {/* ── TEMPLATE TAB ── */}
          {mode === "template" && (
            <>
              {/* Recipient mode toggle */}
              <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 10, padding: 3, gap: 2 }}>
                {[{ id: "single", label: "👤 אורח בודד" }, { id: "audience", label: "👥 קהל נבחר" }].map((m) => (
                  <button key={m.id}
                    onClick={() => { setTmplMode(m.id); setErr(null); setTmplBulkDone(false); setTmplBulkProgress(null); }}
                    style={{
                      flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
                      fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer",
                      background: tmplMode === m.id ? "white" : "transparent",
                      color: tmplMode === m.id ? "#075E54" : "#6B7280",
                      boxShadow: tmplMode === m.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Audience filter chips (audience mode) */}
              {tmplMode === "audience" && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🎯 קהל יעד</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { id: "checked_in",     label: "שוהים עכשיו 🏨" },
                      { id: "expected",       label: "מגיעים בקרוב 📅" },
                      { id: "arriving_today", label: "מגיעים היום 🌅" },
                      { id: "suite",          label: "אורחי סוויטות 👑" },
                      { id: "past",           label: "לקוחות עבר 📋" },
                    ].map((f) => (
                      <button key={f.id}
                        onClick={() => { setTmplAudienceFilter(f.id); setTmplBulkDone(false); setTmplBulkProgress(null); }}
                        style={{
                          padding: "7px 13px", borderRadius: 20, border: "2px solid",
                          borderColor: tmplAudienceFilter === f.id ? "#075E54" : "#E5E7EB",
                          background: tmplAudienceFilter === f.id ? "#E8F5EF" : "white",
                          color: tmplAudienceFilter === f.id ? "#075E54" : "#555",
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                          fontFamily: "inherit", transition: "all 0.15s",
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div style={{
                    marginTop: 8, padding: "8px 12px", borderRadius: 8,
                    background: tmplAudienceGuests.length > 0 ? "#E8F5EF" : "#F9FAFB",
                    border: `1px solid ${tmplAudienceGuests.length > 0 ? "#25D366" : "#E5E7EB"}`,
                    fontSize: 13, fontWeight: 700,
                    color: tmplAudienceGuests.length > 0 ? "#075E54" : "#9CA3AF",
                  }}>
                    {tmplAudienceGuests.length > 0 ? `👥 ${tmplAudienceGuests.length} נמענים` : "⏳ טוען..."}
                    {tmplAudienceGuests.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, marginRight: 8, color: "#555" }}>
                        {tmplAudienceGuests.slice(0, 3).map(g => g.name).join(", ") + (tmplAudienceGuests.length > 3 ? ` ועוד ${tmplAudienceGuests.length - 3}` : "")}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  📋 בחר תבנית
                </div>
                {loadingTmpls ? (
                  <div style={{ fontSize: 13, color: "#888", padding: "12px 0", textAlign: "center" }}>⏳ טוען תבניות...</div>
                ) : allTmpls.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#aaa", padding: "12px 0", textAlign: "center" }}>
                    לא נמצאו תבניות מאושרות.<br />
                    <span style={{ fontSize: 11 }}>הגדר תבניות ב-Meta Business Manager</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {allTmpls.map((t) => (
                      <div key={t.name}
                        onClick={() => pickTemplate(t)}
                        onMouseEnter={() => setHoveredTmpl(t.name)}
                        onMouseLeave={() => setHoveredTmpl(null)}
                        style={{
                          padding: "12px 16px", borderRadius: 12, cursor: "pointer",
                          border: "2px solid",
                          borderColor: selectedTmpl?.name === t.name ? "#25D366" : (hoveredTmpl === t.name ? "#c3e6cb" : "#E5E7EB"),
                          background: selectedTmpl?.name === t.name ? "#E8F5EF" : (hoveredTmpl === t.name ? "#F9FFFE" : "white"),
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span style={{ fontSize: 20 }}>{t.emoji}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a" }}>{t.name}</div>
                              {t.source === "wa" && (
                                <span style={{ fontSize: 10, background: "#D1FAE5", color: "#065F46", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                                  מאושר Meta
                                </span>
                              )}
                            </div>
                          </div>
                          {selectedTmpl?.name === t.name && (
                            <span style={{ color: "#25D366", fontSize: 18, fontWeight: 800 }}>✓</span>
                          )}
                        </div>
                        {t.bodyText && (
                          <div style={{
                            marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.5,
                            maxHeight: 48, overflow: "hidden",
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          }}>
                            {t.bodyText}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Variable inputs */}
              {selectedTmpl && (selectedTmpl.varCount ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    🔧 ערכי משתנים
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {varValues.map((val, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{
                          background: "#075E54", color: "white", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, fontWeight: 700,
                          fontFamily: "monospace", flexShrink: 0,
                        }}>
                          {`{{${idx + 1}}}`}
                        </span>
                        <input type="text" value={val}
                          onChange={(e) => {
                            const next = [...varValues]; next[idx] = e.target.value; setVarValues(next);
                          }}
                          placeholder={
                            idx === 0 && selectedGuest ? selectedGuest.name :
                            idx === 1 && selectedGuest?.room ? `חדר ${selectedGuest.room}` :
                            idx === 2 && selectedGuest?.arrival_date ? selectedGuest.arrival_date :
                            VAR_LABELS[idx] ?? `משתנה ${idx + 1}`
                          }
                          style={{
                            flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 13,
                            border: "1.5px solid #ddd", outline: "none", fontFamily: "inherit",
                          }}
                          onFocus={(e) => e.target.style.borderColor = "#25D366"}
                          onBlur={(e) => e.target.style.borderColor = "#ddd"}
                        />
                      </div>
                    ))}
                    {selectedGuest && varValues.length > 0 && (
                      <button
                        onClick={() => {
                          const next = [...varValues];
                          if (next[0] === "" && selectedGuest.name)           next[0] = selectedGuest.name;
                          if (next[1] === "" && selectedGuest.room)            next[1] = `${selectedGuest.room}`;
                          if (next[2] === "" && selectedGuest.arrival_date)    next[2] = selectedGuest.arrival_date;
                          setVarValues(next);
                        }}
                        style={{
                          alignSelf: "flex-start", padding: "6px 12px",
                          border: "1.5px solid #25D366", borderRadius: 8, background: "white",
                          color: "#075E54", fontSize: 12, fontWeight: 700,
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        ⚡ מלא אוטומטית מפרטי האורח
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Preview */}
              {buildPreview() && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    👁️ תצוגה מקדימה
                  </div>
                  <div style={{
                    background: "#DCF8C6", borderRadius: "18px 18px 4px 18px",
                    padding: "10px 14px", fontSize: 12, lineHeight: 1.6,
                    color: "#1a1a1a", direction: "ltr", textAlign: "left",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)", maxHeight: 120, overflowY: "auto",
                  }}>
                    {buildPreview()}
                    <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>✓✓ עכשיו</div>
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              {/* Progress bar (audience mode) */}
              {tmplBulkProgress && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 4 }}>
                    <span>{tmplBulkDone ? "✅ שליחה הושלמה!" : `שולח... ${tmplBulkProgress.done}/${tmplBulkProgress.total}`}</span>
                    <span>{Math.round((tmplBulkProgress.done / tmplBulkProgress.total) * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, transition: "width 0.4s",
                      width: `${(tmplBulkProgress.done / tmplBulkProgress.total) * 100}%`,
                      background: tmplBulkDone ? "#25D366" : "linear-gradient(90deg, #25D366, #128C7E)",
                    }} />
                  </div>
                </div>
              )}

              {tmplBulkDone ? (
                <button onClick={onClose} style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: "#25D366", color: "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
                }}>✅ סגור</button>
              ) : tmplMode === "audience" ? (
                <button onClick={handleSendTemplateAudience}
                  disabled={tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #128C7E 0%, #075E54 100%)",
                    color: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {tmplBulkSending
                    ? `⏳ שולח... ${tmplBulkProgress?.done ?? 0}/${tmplAudienceGuests.length}`
                    : `📢 שלח ל-${tmplAudienceGuests.length} נמענים`}
                </button>
              ) : (
                <button onClick={handleSendTemplate}
                  disabled={sending || !selectedGuest || !selectedTmpl}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: sending || !selectedGuest || !selectedTmpl
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
                    color: sending || !selectedGuest || !selectedTmpl ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: sending || !selectedGuest || !selectedTmpl ? "not-allowed" : "pointer",
                    transition: "all 0.2s", letterSpacing: 0.3,
                  }}
                >
                  {sending ? "⏳ שולח..." : "📤 שלח תבנית"}
                </button>
              )}
            </>
          )}

          {/* ── BULK TAB ── */}
          {mode === "bulk" && (
            <>
              {/* Filter chips */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  🎯 קהל יעד
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { id: "checked_in",     label: "שוהים עכשיו 🏨" },
                    { id: "expected",       label: "מגיעים בקרוב 📅" },
                    { id: "suite",          label: "אורחי סוויטות 👑" },
                    { id: "day_guest",      label: "אורחי יום ☀️" },
                    { id: "checkout_today", label: "יוצאים היום 🧳" },
                    { id: "all",            label: "כולם 📋" },
                  ].map((f) => (
                    <button key={f.id} onClick={() => { setBulkFilter(f.id); setBulkDone(false); setBulkProgress(null); }}
                      style={{
                        padding: "7px 13px", borderRadius: 20, border: "2px solid",
                        borderColor: bulkFilter === f.id ? "#075E54" : "#E5E7EB",
                        background: bulkFilter === f.id ? "#E8F5EF" : "white",
                        color: bulkFilter === f.id ? "#075E54" : "#555",
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipient count + preview toggle */}
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: bulkGuests.length > 0 ? "#E8F5EF" : "#F9FAFB",
                border: `1px solid ${bulkGuests.length > 0 ? "#25D366" : "#E5E7EB"}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: bulkGuests.length > 0 ? "#075E54" : "#9CA3AF" }}>
                  {bulkGuests.length > 0 ? `👥 ${bulkGuests.length} נמענים` : "⏳ טוען..."}
                </span>
                {bulkGuests.length > 0 && (
                  <button onClick={() => setShowBulkList((p) => !p)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#075E54", fontFamily: "inherit", fontWeight: 600 }}>
                    {showBulkList ? "▲ הסתר" : "▼ הצג רשימה"}
                  </button>
                )}
              </div>

              {/* Collapsible names list */}
              {showBulkList && bulkGuests.length > 0 && (
                <div style={{
                  maxHeight: 130, overflowY: "auto",
                  border: "1px solid #E5E7EB", borderRadius: 10,
                  background: "#FAFAFA",
                }}>
                  {bulkGuests.map((g) => (
                    <div key={g.id} style={{
                      padding: "7px 14px", fontSize: 12, borderBottom: "1px solid #F3F4F6",
                      display: "flex", justifyContent: "space-between",
                    }}>
                      <span style={{ fontWeight: 600 }}>{g.name}</span>
                      <span style={{ color: "#888", direction: "ltr" }}>{g.room ? `חדר ${g.room}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick phrases (personalised with {{שם}}) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  ⚡ ביטויים מהירים
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_PHRASES.map((ph, i) => (
                    <button key={i} onClick={() => setBulkText(ph.text)}
                      style={{
                        padding: "6px 12px", borderRadius: 20, border: "1.5px solid #E0D5C5",
                        background: "#FAFAFA", color: "#444",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#075E54"; e.currentTarget.style.background = "#E8F5EF"; e.currentTarget.style.color = "#075E54"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E0D5C5"; e.currentTarget.style.background = "#FAFAFA"; e.currentTarget.style.color = "#444"; }}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>
                  💡 השתמש ב-<code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{שם}}"}</code> לשם אישי של כל אורח
                </div>
              </div>

              {/* Bulk textarea */}
              <div style={{ position: "relative" }}>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value.slice(0, 1000))}
                  placeholder={`כתוב הודעה... השתמש ב-{{שם}} לשם אישי`}
                  rows={4}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 16px", paddingBottom: 28,
                    borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                    border: "1.5px solid #ddd", outline: "none",
                    fontFamily: "inherit", direction: "rtl", resize: "vertical",
                    background: "#FAFAFA",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#25D366"}
                  onBlur={(e) => e.target.style.borderColor = "#ddd"}
                />
                <div style={{ position: "absolute", bottom: 8, left: 12, fontSize: 11, color: bulkText.length > 900 ? "#DC2626" : "#aaa" }}>
                  {bulkText.length}/1000
                </div>
              </div>

              {/* Progress bar */}
              {bulkProgress && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 4 }}>
                    <span>{bulkDone ? "✅ שליחה הושלמה!" : `שולח... ${bulkProgress.done}/${bulkProgress.total}`}</span>
                    <span>{Math.round((bulkProgress.done / bulkProgress.total) * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, transition: "width 0.4s",
                      width: `${(bulkProgress.done / bulkProgress.total) * 100}%`,
                      background: bulkDone ? "#25D366" : "linear-gradient(90deg, #25D366, #128C7E)",
                    }} />
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              {bulkDone ? (
                <button onClick={onClose} style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: "#25D366", color: "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
                }}>
                  ✅ סגור
                </button>
              ) : (
                <button onClick={handleSendBulk}
                  disabled={bulkSending || !bulkText.trim() || bulkGuests.length === 0}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: bulkSending || !bulkText.trim() || bulkGuests.length === 0
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #128C7E 0%, #075E54 100%)",
                    color: bulkSending || !bulkText.trim() || bulkGuests.length === 0 ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: bulkSending || !bulkText.trim() || bulkGuests.length === 0 ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {bulkSending ? `⏳ שולח... ${bulkProgress?.done ?? 0}/${bulkGuests.length}` : `📢 שלח ל-${bulkGuests.length} נמענים`}
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WhatsAppInbox() {
  const [contacts, setContacts]   = useState([]); // grouped by phone
  const [active, setActive]       = useState(null); // selected phone
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [reply, setReply]         = useState("");
  const [error, setError]         = useState(null);
  const [showNewChat, setShowNewChat] = useState(false);
  // ── Bot active / human-handover toggle ───────────────────────────────────
  const [botActive, setBotActive]     = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const bottomRef = useRef(null);
  const pollRef   = useRef(null);

  // ── Fetch all conversations ────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("whatsapp_conversations")
      .select(`
        id, phone, direction, message, wa_message_id, created_at,
        human_requested, human_request_type,
        guests ( name )
      `)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (err) { setError(err.message); return; }

    const flat = (data ?? []).map((r) => ({
      ...r,
      guest_name:          r.guests?.name ?? null,
      human_requested:     r.human_requested     ?? false,
      human_request_type:  r.human_request_type  ?? null,
    }));

    const grouped = groupByPhone(flat);
    setContacts(grouped);
    setLoading(false);
  }, []);

  // ── Initial load + polling fallback ──────────────────────────────────────
  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  // ── Fetch bot active status from bot_config ───────────────────────────────
  useEffect(() => {
    supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "bot_active")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBotActive(data.config_value !== "false");
      });
  }, []);

  // ── Toggle bot active flag ────────────────────────────────────────────────
  async function toggleBot() {
    setTogglingBot(true);
    const newVal = !botActive;
    await supabase
      .from("bot_config")
      .upsert({ config_key: "bot_active", config_value: String(newVal) }, { onConflict: "config_key" });
    setBotActive(newVal);
    setTogglingBot(false);
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("wa-inbox-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_conversations" },
        () => fetchAll()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll]);

  // ── Auto-scroll to bottom of thread ─────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active, contacts]);

  // ── Manual reply send ─────────────────────────────────────────────────────
  async function sendManualReply() {
    if (!reply.trim() || !active) return;
    setSending(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "inbox_reply",
          phone: active,
          message: reply.trim(),
        },
      });
      if (fnErr || !data?.ok) throw new Error(fnErr?.message ?? data?.error ?? "שגיאה בשליחה");
      setReply("");
      await fetchAll();
    } catch (err) {
      setError(err?.message ?? "שגיאה בשליחה");
    } finally {
      setSending(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeContact = contacts.find((c) => c.phone === active) ?? null;
  const thread        = activeContact?.messages ?? [];
  const unreadTotal   = contacts.reduce((sum, c) => {
    return sum + c.messages.filter((m) => m.direction === "inbound" && !m._read).length;
  }, 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)", overflow: "hidden", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", background: "#075E54", color: "white", flexShrink: 0,
        borderRadius: "12px 12px 0 0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{"💬 DREAM BOT — תיבת שיחות"}</span>
          {unreadTotal > 0 && (
            <span style={{
              background: "#25D366", color: "white", borderRadius: 20,
              fontSize: 11, fontWeight: 800, padding: "2px 8px",
            }}>{unreadTotal} {"חדשות"}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={toggleBot}
            disabled={togglingBot}
            style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: "1.5px solid rgba(255,255,255,0.4)",
              background: botActive ? "rgba(37,211,102,0.25)" : "rgba(255,255,255,0.12)",
              color: "white", cursor: togglingBot ? "not-allowed" : "pointer",
            }}
          >
            {togglingBot ? "⏳" : botActive ? "🤖 בוט פעיל" : "😴 בוט כבוי"}
          </button>
          <button
            onClick={() => setShowNewChat(true)}
            style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: "white", color: "#075E54", border: "none", cursor: "pointer",
            }}
          >
            {"✉️ חדש"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Right: contact list */}
        <div style={{
          width: 290, borderLeft: "1px solid #e0e0e0",
          overflowY: "auto", background: "#ffffff", flexShrink: 0,
        }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid #f0f0f0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "#F7F7F7",
          }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: "#555" }}>
              {contacts.length} {"הודעות"}
            </span>
            {loading && <span style={{ fontSize: 11, color: "#aaa" }}>{"⏳ מסנכרן..."}</span>}
          </div>
          {!loading && contacts.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#aaa" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{"📭"}</div>
              <div style={{ fontSize: 13 }}>{"אין שיחות עדיין"}</div>
            </div>
          )}
          {contacts.map((c) => (
            <ContactItem
              key={c.phone}
              contact={c}
              isActive={active === c.phone}
              onClick={() => setActive(c.phone)}
            />
          ))}
        </div>

        {/* Left: chat thread */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!active ? (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              background: "#E5DDD5", color: "#666", flexDirection: "column", gap: 10,
            }}>
              <div style={{ fontSize: 52 }}>{"💬"}</div>
              <div style={{ fontSize: 15 }}>{"בחר שיחה כדי לצפות בה"}</div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div style={{
                padding: "10px 16px", borderBottom: "1px solid #e0e0e0",
                background: "#128C7E", color: "white",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexShrink: 0,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {activeContact?.guestName ?? active}
                  </div>
                  {activeContact?.guestName && (
                    <div style={{ fontSize: 11, opacity: 0.75, direction: "ltr", marginTop: 1 }}>
                      {active}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{thread.length} {"הודעות"}</div>
              </div>

              {/* Messages */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "16px 20px",
                background: "#E5DDD5", display: "flex", flexDirection: "column", gap: 4,
              }}>
                {thread.map((msg) => (
                  <Bubble key={msg.id} msg={msg} />
                ))}
                <div ref={bottomRef} />
              </div>

              {error && (
                <div style={{ padding: "6px 16px", background: "#FFF0EE", color: "#C0392B", fontSize: 12, flexShrink: 0 }}>
                  {"⚠️"} {error}
                </div>
              )}

              {/* Reply input */}
              <div style={{
                padding: "10px 14px", borderTop: "1px solid #e0e0e0",
                background: "#F0F0F0", display: "flex", gap: 8, alignItems: "flex-end",
                flexShrink: 0,
              }}>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendManualReply(); }
                  }}
                  placeholder="כתוב הודעה ידנית... (Enter לשליחה)"
                  rows={2}
                  style={{
                    flex: 1, resize: "none", borderRadius: 20,
                    border: "1px solid #ddd", padding: "10px 16px",
                    fontSize: 14, fontFamily: "Heebo, sans-serif",
                    outline: "none", lineHeight: 1.5, background: "white",
                  }}
                />
                <button
                  onClick={sendManualReply}
                  disabled={sending || !reply.trim()}
                  style={{
                    background: (sending || !reply.trim()) ? "#ccc" : "#25D366",
                    color: "white", border: "none", borderRadius: "50%",
                    width: 44, height: 44, fontSize: 20,
                    cursor: (sending || !reply.trim()) ? "not-allowed" : "pointer",
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {sending ? "⏳" : "➤"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onSent={() => { setShowNewChat(false); setTimeout(fetchAll, 600); }}
        />
      )}
    </div>
  );
}
