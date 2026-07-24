// ACC — Dream Bot control: SOS lock, service-window opener, quick schedule hooks.

import { useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { israelTomorrowYmd } from "../utils/israelTime";

const COHORTS = [
  { id: "active", label: "🌴 בריזורט + מגיעים היום/מחר", desc: "כל הסוויטות הרלוונטיות" },
  { id: "in_resort", label: "🏨 בריזורט עכשיו", desc: "checked_in בלבד" },
  { id: "arriving_tomorrow", label: "🌅 מגיעים מחר", desc: "arrival מחר" },
  { id: "arrival_today", label: "📅 הגעות היום", desc: "arrival היום" },
];

const TEMPLATE_PREVIEW = `היי {שם}, אנחנו זמינים לכם בצ'אט לכל מה שצריך במהלך השהות בדרים איילנד 🌴

בקשות חדר, מגבות, ניקיון, שאלות על המתחם — פשוט כתבו לנו כאן.

כפתורים: «יש לי בקשה» | «הכל בסדר, תודה»`;

export default function DreamBotGuestControlPanel({
  onToast,
  systemStatus,
  onEnsureDreamBot,
  onQuickScheduleTomorrow,
  ensuringDreamBot = false,
}) {
  const [busy, setBusy] = useState(false);
  const [cohort, setCohort] = useState("active");
  const [onlyMissingWindow, setOnlyMissingWindow] = useState(true);
  const [dryResult, setDryResult] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const dreamBotActive =
    systemStatus?.guestSuitesChannel === "meta" &&
    (systemStatus?.whapiGuestSosActive || systemStatus?.whapiDevice?.sosManual);

  const runDryRun = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setBusy(true);
    setDryResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("guest-emergency-broadcast", {
        body: { dry_run: true, cohort, only_missing_meta_window: onlyMissingWindow },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "dry_run failed");
      setDryResult(data);
      onToast?.("ok", `תצוגה: ${data.eligible} אורחים (${data.cohort_label ?? cohort})`);
    } catch (e) {
      onToast?.("err", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [onToast, cohort, onlyMissingWindow]);

  const runSend = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setBusy(true);
    setConfirmSend(false);
    try {
      const { data, error } = await supabase.functions.invoke("guest-emergency-broadcast", {
        body: {
          dry_run: false,
          cohort,
          only_missing_meta_window: onlyMissingWindow,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "send failed");
      onToast?.("ok", `נשלחו ${data.sent} / ${data.eligible} (נכשלו: ${data.failed})`);
      setDryResult(data);
    } catch (e) {
      onToast?.("err", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [onToast, cohort, onlyMissingWindow]);

  return (
    <div style={{
      marginBottom: 12, padding: "14px 16px", borderRadius: 12,
      border: "2px solid #0369A1", background: "linear-gradient(135deg, rgba(3,105,161,0.08), rgba(14,165,233,0.05))",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: "#0369A1" }}>
        🔵 שליטה ותזמון — Dream Bot
      </div>

      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 12,
      }}>
        <span style={{
          padding: "4px 10px", borderRadius: 20, fontWeight: 700,
          background: dreamBotActive ? "#DCFCE7" : "#FEE2E2",
          color: dreamBotActive ? "#166534" : "#991B1B",
          border: `1px solid ${dreamBotActive ? "#86EFAC" : "#FECACA"}`,
        }}>
          {dreamBotActive ? "✅ Dream Bot פעיל לאוטומציה" : "⚠️ עדיין לא נעול ל-Dream Bot"}
        </span>
        <span style={{ color: "#64748b", alignSelf: "center" }}>
          ערוץ סוויטות: <strong>{systemStatus?.guestSuitesChannel === "meta" ? "Meta" : "Whapi"}</strong>
        </span>
      </div>

      {!dreamBotActive && onEnsureDreamBot && (
        <button
          type="button"
          className="btn btn-primary btn-sm actr-touch-btn"
          style={{ marginBottom: 12 }}
          disabled={ensuringDreamBot}
          onClick={onEnsureDreamBot}
        >
          {ensuringDreamBot ? "⏳ מפעיל..." : "🚨 הפעל Dream Bot לכל האוטומציה (SOS + Meta)"}
        </button>
      )}

      <p style={{ fontSize: 12, color: "#334155", margin: "0 0 10px", lineHeight: 1.55 }}>
        <strong>שלב 1 — פתיחת חלון Meta:</strong> שולח <code>dream_service_fallback</code> דרך Dream Bot.
        חובה לאורחים שהתכתבו רק עם מכשיר הסוויטות לפני תזמון הודעות חופשיות.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          קהל:
          <select
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
            disabled={busy}
            style={{
              marginRight: 6, padding: "6px 10px", borderRadius: 8,
              border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 12,
            }}
          >
            {COHORTS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={onlyMissingWindow}
            onChange={(e) => setOnlyMissingWindow(e.target.checked)}
            disabled={busy}
          />
          רק בלי חלון Meta פתוח
        </label>
      </div>

      <details style={{ fontSize: 11.5, color: "#64748b", marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>תצוגה מקדימה תבנית</summary>
        <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{TEMPLATE_PREVIEW}</pre>
      </details>

      {dryResult && (
        <div style={{ fontSize: 12, marginBottom: 10, color: "#0f172a", background: "#fff", borderRadius: 8, padding: 10, border: "1px solid #e2e8f0" }}>
          <strong>{dryResult.cohort_label ?? cohort}</strong>
          {dryResult.only_missing_meta_window && " · בלי חלון Meta"}
          {" · "}זכאים: <strong>{dryResult.eligible ?? dryResult.sent ?? "—"}</strong>
          {dryResult.sample?.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingRight: 18, maxHeight: 100, overflowY: "auto" }}>
              {dryResult.sample.map((s) => (
                <li key={s.id ?? s.phone}>{s.name} ({s.phone})</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm actr-touch-btn" disabled={busy} onClick={runDryRun}>
          {busy ? "⏳" : "👁"} תצוגה מקדימה
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm actr-touch-btn"
          disabled={busy}
          onClick={() => setConfirmSend(true)}
        >
          🌴 פתח חלון שירות (Dream Bot)
        </button>
      </div>

      {confirmSend && (
        <div style={{
          marginBottom: 10, padding: 10, borderRadius: 8,
          background: "#FFF8E7", border: "1px solid #C9A96E", fontSize: 12,
        }}>
          <strong>לאשר שליחה?</strong> Meta בלבד, 2.5ש׳ בין הודעות.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={runSend}>
              כן, שלח
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmSend(false)}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {onQuickScheduleTomorrow && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: "1px dashed #94a3b8",
        }}>
          <p style={{ fontSize: 12, color: "#334155", margin: "0 0 8px", lineHeight: 1.55 }}>
            <strong>שלב 2 — תזמון אוטומציה:</strong> בחר שורות בתור למטה → «תזמון» → מחר {israelTomorrowYmd()} 08:00.
            ה-cron ישלח דרך Dream Bot (לא Whapi).
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm actr-touch-btn"
            onClick={onQuickScheduleTomorrow}
          >
            📅 בחר ממתינים (בריזורט+מחר) ופתח תזמון מחר 08:00
          </button>
        </div>
      )}
    </div>
  );
}
