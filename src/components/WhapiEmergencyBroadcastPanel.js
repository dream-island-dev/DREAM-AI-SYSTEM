// ACC — Whapi SOS emergency broadcast (dream_service_fallback to today's arrivals).

import { useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const TEMPLATE_PREVIEW = `היי {שם}, אנחנו זמינים לכם בצ'אט לכל מה שצריך במהלך השהות בדרים איילנד 🌴

בקשות חדר, מגבות, ניקיון, שאלות על המתחם — פשוט כתבו לנו כאן.

כפתורים: «יש לי בקשה» | «הכל בסדר, תודה»`;

export default function WhapiEmergencyBroadcastPanel({ onToast }) {
  const [busy, setBusy] = useState(false);
  const [dryResult, setDryResult] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const runDryRun = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setBusy(true);
    setDryResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("guest-emergency-broadcast", {
        body: { dry_run: true },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "dry_run failed");
      setDryResult(data);
      onToast?.("ok", `תצוגה: ${data.eligible} אורחי הגעה היום`);
    } catch (e) {
      onToast?.("err", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [onToast]);

  const runSend = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setBusy(true);
    setConfirmSend(false);
    try {
      const { data, error } = await supabase.functions.invoke("guest-emergency-broadcast", {
        body: { dry_run: false },
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
  }, [onToast]);

  return (
    <div style={{
      marginBottom: 12, padding: "12px 14px", borderRadius: 10,
      border: "1px solid #0369A1", background: "rgba(3,105,161,0.06)",
    }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: "#0369A1" }}>
        📣 גיבוי שירות — Dream Bot (הגעות היום)
      </div>
      <p style={{ fontSize: 12, color: "#334155", margin: "0 0 8px", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        תבנית <code>dream_service_fallback</code> — רק אורחים עם <strong>arrival_date = היום</strong>.
        שליחה דרך Meta בלבד, 2.5 שניות בין הודעות.
      </p>
      <details style={{ fontSize: 11.5, color: "#64748b", marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>תצוגה מקדימה</summary>
        <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{TEMPLATE_PREVIEW}</pre>
      </details>
      {dryResult && (
        <div style={{ fontSize: 12, marginBottom: 8, color: "#0f172a" }}>
          {dryResult.arrival_date && <span>תאריך: {dryResult.arrival_date} · </span>}
          זכאים: <strong>{dryResult.eligible ?? dryResult.sent ?? "—"}</strong>
          {dryResult.sample?.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingRight: 18 }}>
              {dryResult.sample.map((s) => (
                <li key={s.id ?? s.phone}>{s.name} ({s.phone})</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={runDryRun}>
          {busy ? "⏳" : "👁"} תצוגה מקדימה
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => setConfirmSend(true)}
        >
          📣 שלח גיבוי
        </button>
      </div>
      {confirmSend && (
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 8,
          background: "#FFF8E7", border: "1px solid #C9A96E", fontSize: 12,
        }}>
          <strong>לאשר שליחה?</strong> רק אורחי הגעה היום, תבנית Meta (חייבת APPROVED).
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
    </div>
  );
}
