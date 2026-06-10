// src/components/WhatsAppInbox.js
// Dream Island — WhatsApp Conversation Inbox
// Two-panel UI: contact list (right) + message thread (left, RTL)
// Real-time updates via Supabase Realtime

import React, { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";

const POLL_MS = 8000; // fallback polling interval

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
        background: isOut ? "#dcf8c6" : "white",
        border: isOut ? "none" : "1px solid #e8e8e8",
        borderRadius: isOut ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        padding: "8px 12px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
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

// ── Main component ────────────────────────────────────────────────────────────
export default function WhatsAppInbox() {
  const [contacts, setContacts]   = useState([]); // grouped by phone
  const [active, setActive]       = useState(null); // selected phone
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [reply, setReply]         = useState("");
  const [error, setError]         = useState(null);
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
          phone:   active,
          message: reply.trim(),
        },
      });
      // supabase.functions.invoke wraps non-2xx in fnErr; real detail is in data?.error
      if (fnErr) throw new Error(data?.error ?? fnErr.message ?? "שגיאה בשליחה");
      if (data && !data.ok) throw new Error(data.error ?? "שגיאה בשליחה");
      setReply("");
      await fetchAll();
    } catch (e) {
      setError(e?.message ?? "שגיאה בשליחה");
    } finally {
      setSending(false);
    }
  }

  // ── Active thread messages ────────────────────────────────────────────────
  const activeContact = contacts.find((c) => c.phone === active);
  const thread = activeContact?.messages ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      height: "calc(100vh - 120px)",
      fontFamily: "Segoe UI, Arial, sans-serif",
      direction: "rtl",
      background: "#f5f5f5",
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 2px 16px rgba(0,0,0,0.1)",
    }}>

      {/* ── Contact list (right panel) ───────────────────────────────────── */}
      <div style={{
        width: 320,
        borderLeft: "1px solid #e0e0e0",
        background: "white",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          background: "#075E54",
          color: "white",
          fontSize: 18,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span>💬</span>
          <span>DREAM BOT — שיחות</span>
          <div style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {loading && <span style={{ fontSize: 12, opacity: 0.7 }}>טוען...</span>}
            <button
              onClick={toggleBot}
              disabled={togglingBot}
              title={botActive ? "לחץ להשתיק — מעבר למענה אנושי" : "לחץ להפעיל את הרובוט"}
              style={{
                background: botActive ? "rgba(255,255,255,0.15)" : "rgba(239,68,68,0.35)",
                color: "white",
                border: `1px solid ${botActive ? "rgba(255,255,255,0.35)" : "rgba(239,68,68,0.6)"}`,
                borderRadius: 20,
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: 700,
                cursor: togglingBot ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                transition: "all 0.2s",
              }}
            >
              {togglingBot ? "⏳" : botActive ? "🟢 רובוט מופעל" : "🔴 מענה אנושי"}
            </button>
          </div>
        </div>

        {/* Contact list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {error && (
            <div style={{ padding: 16, color: "red", fontSize: 13 }}>שגיאה: {error}</div>
          )}
          {!loading && contacts.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 14 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
              עדיין אין שיחות.<br />
              שיחות יופיעו כאשר לקוחות ישלחו הודעות.
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

        {/* Stats bar */}
        <div style={{
          padding: "8px 16px",
          background: "#f9f9f9",
          borderTop: "1px solid #eee",
          fontSize: 12,
          color: "#888",
        }}>
          {contacts.length} שיחות פעילות
        </div>
      </div>

      {/* ── Message thread (left panel) ──────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#efeae2",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c0b8' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      }}>
        {!active ? (
          /* Empty state */
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            color: "#888",
          }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>DREAM BOT Inbox</div>
            <div style={{ fontSize: 14, color: "#aaa" }}>בחר שיחה מהרשימה כדי לצפות בהודעות</div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{
              padding: "12px 20px",
              background: "#075E54",
              color: "white",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "#25D366",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 16,
              }}>
                {(activeContact?.guestName ?? activeContact?.phone)?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {activeContact?.guestName ?? activeContact?.phone}
                </div>
                {activeContact?.guestName && (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{activeContact?.phone}</div>
                )}
              </div>
              <div style={{ marginRight: "auto", fontSize: 12, opacity: 0.7 }}>
                {thread.length} הודעות
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {thread.map((msg) => (
                <Bubble key={msg.id} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Reply input */}
            <div style={{
              padding: "12px 16px",
              background: "#f0f0f0",
              borderTop: "1px solid #ddd",
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
            }}>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendManualReply();
                  }
                }}
                placeholder="כתוב הודעה ידנית... (Enter לשליחה)"
                rows={2}
                style={{
                  flex: 1,
                  border: "1px solid #ddd",
                  borderRadius: 20,
                  padding: "10px 16px",
                  fontSize: 14,
                  resize: "none",
                  outline: "none",
                  fontFamily: "inherit",
                  direction: "rtl",
                  background: "white",
                }}
              />
              <button
                onClick={sendManualReply}
                disabled={sending || !reply.trim()}
                style={{
                  background: sending || !reply.trim() ? "#ccc" : "#25D366",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  width: 44,
                  height: 44,
                  fontSize: 20,
                  cursor: sending || !reply.trim() ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {sending ? "⏳" : "➤"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
