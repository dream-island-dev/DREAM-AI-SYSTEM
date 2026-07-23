// Bulk survey-link dispatch to waiter roster via Whapi (suites device).
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { formatInboxOutboundError } from "../utils/inboxSendErrors";
import {
  DEFAULT_WAITER_PULSE_INVITE_MESSAGE,
  WAITER_PULSE_SEND_DELAY_MS,
  parseWaiterPulsePaste,
  personalizeWaiterPulseInvite,
} from "../utils/waiterPulseContacts";

export default function WaiterPulseDispatchPanel({ pulseUrl, canEdit, onToast }) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_WAITER_PULSE_INVITE_MESSAGE);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [failures, setFailures] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [savingNameId, setSavingNameId] = useState(null);

  const toast = useCallback((type, msg) => onToast?.(type, msg), [onToast]);

  const loadContacts = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("waiter_pulse_contacts")
      .select("id, name, phone, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true, nullsFirst: false })
      .order("phone", { ascending: true });
    if (error) {
      toast("err", error.message);
      setContacts([]);
    } else {
      setContacts(data ?? []);
      setSelected(new Set((data ?? []).map((c) => c.id)));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const activeContacts = contacts.filter((c) => c.is_active !== false);
  const targets = activeContacts.filter((c) => selected.has(c.id));

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === activeContacts.length
        ? new Set()
        : new Set(activeContacts.map((c) => c.id)),
    );
  };

  const handleParsePaste = () => {
    const result = parseWaiterPulsePaste(pasteText);
    setPastePreview(result);
    if (result.rows.length === 0 && result.invalid.length === 0) {
      toast("err", "אין שורות לייבוא");
    }
  };

  const handleImportPaste = async () => {
    if (!supabase || !pastePreview?.rows?.length) return;
    setImporting(true);
    try {
      const payload = pastePreview.rows.map((r) => ({
        name: r.name || null,
        phone: r.phone,
        is_active: true,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("waiter_pulse_contacts")
        .upsert(payload, { onConflict: "phone" });
      if (error) throw error;
      toast("ok", `נשמרו ${payload.length} אנשי קשר`);
      setPasteText("");
      setPastePreview(null);
      await loadContacts();
    } catch (e) {
      toast("err", e?.message ?? "שגיאה בייבוא");
    } finally {
      setImporting(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!supabase || !canEdit) return;
    const { error } = await supabase
      .from("waiter_pulse_contacts")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast("err", error.message);
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadContacts();
    }
  };

  const startEditName = (contact) => {
    setEditingId(contact.id);
    setEditingName(contact.name || "");
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveContactName = async (id) => {
    if (!supabase) return;
    const trimmed = editingName.trim();
    setSavingNameId(id);
    try {
      const { error } = await supabase
        .from("waiter_pulse_contacts")
        .update({ name: trimmed || null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed || null } : c)));
      cancelEditName();
    } catch (e) {
      toast("err", e?.message ?? "שגיאה בשמירת שם");
    } finally {
      setSavingNameId(null);
    }
  };

  const handleSend = async () => {
    if (!supabase || !pulseUrl || targets.length === 0) return;
    setConfirmOpen(false);
    setSending(true);
    setSummary(null);
    setFailures([]);
    const results = [];

    for (let i = 0; i < targets.length; i++) {
      const contact = targets[i];
      setProgress({ current: i + 1, total: targets.length });
      const message = personalizeWaiterPulseInvite(messageTemplate, {
        name: contact.name,
        link: pulseUrl,
      });
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: {
            trigger: "inbox_reply",
            phone: contact.phone,
            message,
            inbox_channel: "whapi",
          },
        });
        if (error) {
          results.push({ contact, ok: false, reason: error.message });
        } else if (data?.ok) {
          results.push({ contact, ok: true });
        } else {
          results.push({
            contact,
            ok: false,
            reason: formatInboxOutboundError(data, data?.error, { opLabel: "" }).trim() || "שגיאה",
          });
        }
      } catch (e) {
        results.push({ contact, ok: false, reason: e?.message ?? "שגיאה" });
      }
      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, WAITER_PULSE_SEND_DELAY_MS));
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failedRows = results.filter((r) => !r.ok);
    setFailures(failedRows);
    setSummary({ total: results.length, sent, failed: failedRows.length });
    setSending(false);
    setProgress(null);
    if (sent > 0) toast("ok", `📱 נשלחו ${sent} הודעות דרך מכשיר הסוויטות`);
    if (failedRows.length > 0) toast("err", `${failedRows.length} לא נשלחו — ראה רשימה למטה`);
  };

  const previewSample = targets[0]
    ? personalizeWaiterPulseInvite(messageTemplate, { name: targets[0].name, link: pulseUrl || "https://…" })
    : null;

  return (
    <div style={{
      marginBottom: 20,
      background: "#F0FDF4",
      border: "1px solid #16A34A",
      borderRadius: 14,
      padding: "20px 22px",
      direction: "rtl",
    }}>
      <div style={{ fontWeight: 800, fontSize: 17, color: "#14532D", marginBottom: 4 }}>
        📱 שליחת קישור הסקר למלצרים
      </div>
      <p style={{ fontSize: 12.5, color: "#166534", lineHeight: 1.6, marginBottom: 14, maxWidth: 640 }}>
        שליחה ידנית דרך <strong>מכשיר הסוויטות (Whapi)</strong> — בלי אוטומציות, בלי טבלת אורחים.
        מרווח {WAITER_PULSE_SEND_DELAY_MS / 1000} שניות בין הודעות.
      </p>

      {!pulseUrl && (
        <div style={{
          background: "#FFF8E7", border: "1px solid #C9A96E", borderRadius: 8,
          padding: "8px 12px", fontSize: 12.5, color: "#92400E", marginBottom: 12,
        }}>
          ⚠️ אין קישור פעיל — צור קישור למעלה לפני שליחה.
        </div>
      )}

      {summary && (
        <div style={{
          background: "#DCFCE7", border: "1px solid #16A34A", borderRadius: 8,
          padding: "8px 12px", fontSize: 12.5, color: "#14532D", marginBottom: 12,
        }}>
          ✅ נשלחו {summary.sent} · נכשלו {summary.failed} מתוך {summary.total}
        </div>
      )}

      {sending && progress && (
        <div style={{ fontSize: 12.5, color: "#166534", marginBottom: 10 }}>
          ⏳ שולח {progress.current}/{progress.total}…
        </div>
      )}

      <label style={{ display: "block", marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
          טקסט ההודעה ({"{{שם}}"} / {"{{קישור}}"})
        </div>
        <textarea
          value={messageTemplate}
          onChange={(e) => setMessageTemplate(e.target.value)}
          disabled={sending}
          rows={7}
          style={{
            width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
            border: "1px solid #86EFAC", fontFamily: "inherit", fontSize: 13, lineHeight: 1.55,
            resize: "vertical",
          }}
        />
      </label>

      {previewSample && (
        <div style={{
          fontSize: 12, background: "#fff", border: "1px solid #BBF7D0",
          borderRadius: 8, padding: 10, marginBottom: 14, whiteSpace: "pre-wrap", lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, color: "#166534", marginBottom: 4 }}>תצוגה מקדימה ({targets[0].name || targets[0].phone}):</div>
          {previewSample}
        </div>
      )}

      {canEdit && (
        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#166534" }}>
            ➕ הוסף / ייבא אנשי קשר
          </summary>
          <div style={{ marginTop: 10 }}>
            <textarea
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setPastePreview(null); }}
              placeholder={"שם: +972 50-123-4567\nאו רק מספר בשורה"}
              rows={5}
              style={{
                width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8,
                border: "1px solid #86EFAC", fontFamily: "inherit", fontSize: 12.5,
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={handleParsePaste} style={btnSecondary}>
                בדוק שורות
              </button>
              <button
                type="button"
                onClick={handleImportPaste}
                disabled={!pastePreview?.rows?.length || importing}
                style={btnPrimary}
              >
                {importing ? "שומר…" : `שמור ${pastePreview?.rows?.length ?? 0} לרשימה`}
              </button>
            </div>
            {pastePreview && (
              <div style={{ fontSize: 12, marginTop: 8, color: "#166534" }}>
                ✓ {pastePreview.rows.length} תקינים
                {pastePreview.invalid.length > 0 && (
                  <span style={{ color: "#C0392B" }}> · ⚠ {pastePreview.invalid.length} לא תקינים</span>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {loading ? (
        <div style={{ color: "#166534", fontSize: 13 }}>טוען רשימת מלצרים…</div>
      ) : activeContacts.length === 0 ? (
        <div style={{
          padding: 14, borderRadius: 10, border: "1px dashed #86EFAC",
          color: "#166534", fontSize: 13,
        }}>
          אין אנשי קשר — ייבא רשימה למעלה.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={toggleAll} disabled={sending} style={btnSecondary}>
              {selected.size === activeContacts.length ? "נקה בחירה" : "בחר הכל"}
            </button>
            <span style={{ fontSize: 12, color: "#166534" }}>
              {selected.size} נבחרו מתוך {activeContacts.length}
            </span>
          </div>
          <div style={{
            maxHeight: 260, overflowY: "auto", border: "1px solid #BBF7D0",
            borderRadius: 10, background: "#fff", marginBottom: 14,
          }}>
            {activeContacts.map((c) => (
              <div key={c.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                borderBottom: "1px solid #F0FDF4", fontSize: 13,
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleOne(c.id)}
                  disabled={sending}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === c.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveContactName(c.id);
                          if (e.key === "Escape") cancelEditName();
                        }}
                        disabled={savingNameId === c.id}
                        placeholder="שם בעברית"
                        autoFocus
                        style={{
                          flex: 1, padding: "5px 8px", borderRadius: 6,
                          border: "1px solid #86EFAC", fontFamily: "inherit", fontSize: 13,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => saveContactName(c.id)}
                        disabled={savingNameId === c.id}
                        style={{ ...btnPrimary, padding: "5px 10px", fontSize: 11 }}
                      >
                        {savingNameId === c.id ? "…" : "שמור"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditName}
                        disabled={savingNameId === c.id}
                        style={{ ...btnSecondary, padding: "5px 8px", fontSize: 11 }}
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontWeight: 600,
                        color: c.name ? "inherit" : "#9CA3AF",
                      }}>
                        {c.name || "ללא שם"}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEditName(c)}
                        disabled={sending}
                        title="ערוך שם"
                        style={{
                          border: "none", background: "transparent", color: "#166534",
                          cursor: sending ? "not-allowed" : "pointer", fontSize: 12,
                          padding: "0 2px", fontFamily: "inherit",
                        }}
                      >
                        ✏️
                      </button>
                    </div>
                  )}
                </div>
                <span style={{ color: "#15803D", fontSize: 12, direction: "ltr" }}>{c.phone}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDeactivate(c.id)}
                    disabled={sending}
                    title="הסר מהרשימה"
                    style={{
                      border: "none", background: "transparent", color: "#C0392B",
                      cursor: "pointer", fontSize: 14, padding: "0 4px",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={sending || !pulseUrl || selected.size === 0}
            style={{
              ...btnPrimary,
              padding: "12px 22px",
              fontSize: 14,
              opacity: sending || !pulseUrl || selected.size === 0 ? 0.5 : 1,
              cursor: sending || !pulseUrl || selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            {sending
              ? "⏳ שולח…"
              : `📱 שלח סקר ל-${selected.size} מלצרים (מכשיר סוויטות)`}
          </button>
        </>
      )}

      {failures.length > 0 && (
        <div style={{
          marginTop: 14, background: "#FFF0EE", border: "1px solid #C0392B",
          borderRadius: 8, padding: 10, fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, color: "#C0392B", marginBottom: 6 }}>לא נשלחו:</div>
          {failures.slice(0, 12).map((f, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              {f.contact.name || f.contact.phone} — {f.reason}
            </div>
          ))}
          {failures.length > 12 && (
            <div style={{ color: "#C0392B" }}>…ועוד {failures.length - 12}</div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !sending && setConfirmOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 14, padding: 22, maxWidth: 400, width: "100%",
              direction: "rtl",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>לאשר שליחה?</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              יישלחו <strong>{targets.length}</strong> הודעות דרך מכשיר הסוויטות,
              עם מרווח {WAITER_PULSE_SEND_DELAY_MS / 1000} שניות בין כל אחת.
              משך משוער: ~{Math.ceil((targets.length * WAITER_PULSE_SEND_DELAY_MS) / 60000)} דקות.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={handleSend} style={{ ...btnPrimary, flex: 1 }}>
                כן, שלח
              </button>
              <button type="button" onClick={() => setConfirmOpen(false)} style={btnSecondary}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary = {
  padding: "8px 14px", borderRadius: 8, border: "none",
  background: "#16A34A", color: "#fff", fontWeight: 800,
  fontFamily: "inherit", fontSize: 12, cursor: "pointer",
};

const btnSecondary = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid #86EFAC",
  background: "#fff", color: "#166534", fontWeight: 700,
  fontFamily: "inherit", fontSize: 12, cursor: "pointer",
};
