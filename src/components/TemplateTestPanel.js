import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import QuietHoursGate from "./QuietHoursGate";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
/**
 * Isolated Meta template test sends — is_test:true, no guest pipeline mutation.
 */
export default function TemplateTestPanel({ metaTemplatesByName, showToast, defaultPhone = "" }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const approvedTemplates = Object.values(metaTemplatesByName ?? {})
    .filter((t) => t.status === "APPROVED")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const [templateName, setTemplateName] = useState("");
  const [phone, setPhone] = useState(defaultPhone);
  const [guestId, setGuestId] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    if (!templateName && approvedTemplates.length > 0) {
      setTemplateName(approvedTemplates[0].name);
    }
  }, [approvedTemplates, templateName]);

  useEffect(() => {
    if (defaultPhone && !phone) setPhone(defaultPhone);
  }, [defaultPhone, phone]);

  const handleSendTest = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!templateName) {
      showToast("err", "בחר תבנית מאושרת");
      return;
    }
    if (!phone?.trim()) {
      showToast("err", "הזן מספר יעד לבדיקה");
      return;
    }
    if (!ensureCanSend()) {
      showToast("err", "שליחה חסומה בשעות שקט — סמן את האישור למטה");
      return;
    }

    setSending(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "template_test",
          is_test: true,
          phone: phone.trim(),
          waTemplateName: templateName,
          guestId: guestId.trim() || undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        const msg = `✅ בדיקה נשלחה ל-${phone.trim()} (${templateName})`;
        showToast("ok", msg);
        setLastResult({ ok: true, message: msg });
      } else {
        const apiMsg = data?.error ?? data?.reason ?? "שגיאה לא ידועה";
        setLastResult({ ok: false, message: apiMsg });
        showToast("err", `❌ ${apiMsg}`);
      }
    } catch (e) {
      const msg = e?.message ?? String(e);
      setLastResult({ ok: false, message: msg });
      showToast("err", "שגיאה: " + msg);
    } finally {
      setSending(false);
    }
  }, [templateName, phone, guestId, ensureCanSend, showToast]);

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-header">
        <div className="card-title">🧪 בדיקת / תצוגה מקדימה — תבניות Meta מאושרות</div>
      </div>
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{
          background: "rgba(201,169,110,0.1)",
          border: "1px solid var(--gold)",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          מצב בדיקה מבודד: לא משנה דגלים, ציר זמן או אוטומציה של אורחים.
          רק שליחת תבנית מאושרת למספר שתבחר.
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>תבנית מאושרת (Meta)</label>
          <select
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={sending || approvedTemplates.length === 0}
          >
            {approvedTemplates.length === 0 && (
              <option value="">— אין תבניות מאושרות — סנכרן בלשונית תבניות —</option>
            )}
            {approvedTemplates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>מספר יעד לבדיקה (E.164 / 972…)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+972501234567"
            disabled={sending}
            dir="ltr"
            style={{ textAlign: "left" }}
          />
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>מזהה אורח (אופציונלי — למילוי משתני תבנית בלבד)</label>
          <input
            type="text"
            value={guestId}
            onChange={(e) => setGuestId(e.target.value)}
            placeholder="guests.id — לא מעדכן את האורח"
            disabled={sending}
            dir="ltr"
            style={{ textAlign: "left" }}
          />
        </div>

        <QuietHoursGate
          active={quietActive}
          checked={overrideChecked}
          onChange={setOverrideChecked}
        />

        {lastResult && (
          <div style={{
            background: lastResult.ok ? "#E8F5EF" : "#FFF0EE",
            border: `1px solid ${lastResult.ok ? "#1A7A4A" : "#C0392B"}`,
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 13,
            color: lastResult.ok ? "#1A7A4A" : "#C0392B",
          }}>
            {lastResult.ok ? lastResult.message : `❌ ${lastResult.message}`}
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSendTest}
            disabled={sending || !canSend || !templateName || approvedTemplates.length === 0}
          >
            {sending ? "⏳ שולח בדיקה..." : "📤 שלח בדיקה"}
          </button>
        </div>
      </div>
    </div>
  );
}
