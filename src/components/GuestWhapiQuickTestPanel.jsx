// Quick Whapi test — phone-only guest + send via Suites device (no silent Meta fallback).

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { formatInboxOutboundError } from "../utils/inboxSendErrors";
import {
  findOrCreateGuestByPhone,
  formatDeliveredChannelLabel,
  normalizeQuickSendPhone,
} from "../utils/guestQuickWhapiTest";

export default function GuestWhapiQuickTestPanel({ onToast }) {
  const [phoneRaw, setPhoneRaw] = useState("");
  const [nameHint, setNameHint] = useState("");
  const [message, setMessage] = useState("היי — בדיקת Whapi מ-XOS");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [err, setErr] = useState(null);

  async function handleSend() {
    if (!isSupabaseConfigured || !supabase) {
      setErr("Supabase לא מוגדר");
      return;
    }
    const { phone, error: phoneErr } = normalizeQuickSendPhone(phoneRaw);
    if (!phone) {
      setErr(phoneErr);
      return;
    }
    const body = message.trim();
    if (!body) {
      setErr("נא לכתוב הודעה");
      return;
    }

    setBusy(true);
    setErr(null);
    setLastResult(null);
    try {
      const { guest, created } = await findOrCreateGuestByPhone(supabase, phone, nameHint);
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "inbox_reply",
          phone: guest.phone,
          message: body,
          inbox_channel: "whapi",
        },
      });
      if (error || !data?.ok) {
        throw new Error(formatInboxOutboundError(data, error?.message ?? data?.error));
      }

      const channelLabel = formatDeliveredChannelLabel(data.delivered_channel);
      const summary = {
        guestName: guest.name,
        phone: guest.phone,
        created,
        channel: data.delivered_channel,
        waMessageId: data.wa_message_id ?? null,
        channelLabel,
      };
      setLastResult(summary);
      const toastMsg = created
        ? `✅ פרופיל נוצר + ${channelLabel} → ${guest.phone}`
        : `✅ ${channelLabel} → ${guest.name}`;
      onToast?.("ok", toastMsg);
    } catch (e) {
      const msg = e?.message ?? "שגיאה";
      setErr(msg);
      onToast?.("err", msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24, border: "1px dashed rgba(180,83,9,0.45)" }}>
      <div className="card-header">
        <div className="card-title">🧪 בדיקת Whapi — שליחה מהירה</div>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          צור פרופיל מינימלי לפי טלפון ושלח דרך <strong>מכשיר הסוויטות בלבד</strong>.
          אם Whapi נכשל — תקבל שגיאה (בלי גיבוי שקט ל-Dream Bot).
          מומלץ לשלוח למספר שלך ולבדוק שההודעה מופיעה בוואטסאפ במכשיר.
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>טלפון *</label>
          <input
            type="tel"
            value={phoneRaw}
            onChange={(e) => setPhoneRaw(e.target.value)}
            placeholder="0501234567 או +972…"
            dir="ltr"
            style={{ textAlign: "left" }}
          />
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>שם (אופציונלי — לפרופיל חדש)</label>
          <input
            type="text"
            value={nameHint}
            onChange={(e) => setNameHint(e.target.value)}
            placeholder="בדיקה Whapi"
          />
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>הודעה</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", fontFamily: "Heebo, sans-serif" }}
          />
        </div>

        {err && (
          <div style={{
            background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
            padding: "8px 10px", fontSize: 13, color: "#C0392B",
          }}>
            {err}
          </div>
        )}

        {lastResult && (
          <div style={{
            background: "#E8F5EF", border: "1px solid #1A7A4A", borderRadius: 8,
            padding: "10px 12px", fontSize: 13, color: "#1A7A4A",
          }}>
            <div style={{ fontWeight: 700 }}>{lastResult.channelLabel}</div>
            <div style={{ direction: "ltr", marginTop: 4 }}>{lastResult.phone}</div>
            {lastResult.created && <div style={{ marginTop: 4 }}>פרופיל חדש נוצר: {lastResult.guestName}</div>}
            {lastResult.waMessageId && (
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
                message id: {lastResult.waMessageId}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={handleSend}
        >
          {busy ? "⏳ שולח…" : "📱 שלח דרך מכשיר הסוויטות"}
        </button>
      </div>
    </div>
  );
}
