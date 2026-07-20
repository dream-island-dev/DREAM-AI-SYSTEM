// Standalone spa upsell dispatch — reads live guests from DB (not tied to import session).
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import SpaUpsellConfirmModal from "./SpaUpsellConfirmModal";
import {
  fetchSpaUpsellAudience,
  israelTodayYmd,
  SPA_UPSELL_CHANNEL_META,
  SPA_UPSELL_CHANNEL_WHAPI,
  SPA_UPSELL_META_TEMPLATE,
} from "../utils/spaUpsellAudience";

const SPA_UPSELL_SEND_PULSE_MS = 2500;

export default function SpaUpsellDispatchPanel({ initialDate, onToast }) {
  const [arrivalDate, setArrivalDate] = useState(initialDate || israelTodayYmd());
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [scriptText, setScriptText] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [metaTemplateStatus, setMetaTemplateStatus] = useState(null);

  const toast = useCallback((type, msg) => {
    onToast?.(msg, type);
  }, [onToast]);

  const loadAudience = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setLoadError(null);
    setSummary(null);
    try {
      const [{ guests, error }, scriptRes, tmplRes] = await Promise.all([
        fetchSpaUpsellAudience(supabase, { arrivalDate }),
        supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", "spa_upsell_daypass")
          .maybeSingle(),
        supabase.functions.invoke("get-wa-templates", { body: { all: true } }),
      ]);
      if (error) throw error;
      setCandidates(guests);
      setSelected(new Set(guests.map((g) => g.id)));
      setScriptText(scriptRes.data?.message_text ?? "");
      const templates = tmplRes.data?.templates ?? [];
      const spaPkg = templates.find((t) => t.name === SPA_UPSELL_META_TEMPLATE);
      setMetaTemplateStatus(spaPkg?.status ?? null);
    } catch (e) {
      const msg = e?.message ?? String(e);
      setLoadError(msg);
      setCandidates([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [arrivalDate]);

  useEffect(() => {
    loadAudience();
  }, [loadAudience]);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === candidates.length
        ? new Set()
        : new Set(candidates.map((g) => g.id)),
    );
  };

  const targets = candidates.filter((g) => selected.has(g.id));

  const handleSendNow = async (forceChannel) => {
    if (!supabase || targets.length === 0) return;
    setSending(true);
    setSummary(null);
    const results = [];
    const channel = forceChannel || SPA_UPSELL_CHANNEL_WHAPI;
    for (let i = 0; i < targets.length; i++) {
      const guest = targets[i];
      setProgress({ current: i + 1, total: targets.length });
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: {
            trigger: "spa_upsell_daypass",
            guestId: guest.id,
            force: true,
            force_channel: channel,
          },
        });
        if (error) results.push({ guest, result: "error", error: error.message });
        else if (data?.skipped) results.push({ guest, result: "skipped", reason: data.reason });
        else if (data?.ok) results.push({ guest, result: "sent" });
        else results.push({ guest, result: "failed", error: data?.error ?? "unknown" });
      } catch (e) {
        results.push({ guest, result: "error", error: e?.message ?? String(e) });
      }
      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, SPA_UPSELL_SEND_PULSE_MS));
      }
    }
    const sentIds = new Set(results.filter((r) => r.result === "sent").map((r) => r.guest.id));
    setCandidates((prev) => prev.filter((g) => !sentIds.has(g.id)));
    setSelected(new Set());
    setSending(false);
    setProgress(null);
    setModalOpen(false);
    const sent = results.filter((r) => r.result === "sent").length;
    setSummary({
      total: results.length,
      sent,
      skipped: results.filter((r) => r.result === "skipped").length,
      failed: results.filter((r) => r.result === "failed" || r.result === "error").length,
    });
    if (sent > 0) {
      const via = channel === SPA_UPSELL_CHANNEL_META ? "Dream Bot" : "מכשיר הסוויטות";
      toast("ok", `💆 נשלחו ${sent} הצעות ספא (${via})`);
    }
  };

  const handleSchedule = async (payload) => {
    if (!supabase || !payload?.length) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("staff_schedule_tasks_batch", { p_tasks: payload });
      if (error) throw error;
      const count = typeof data === "number" ? data : payload.length;
      const scheduledIds = new Set(payload.map((p) => p.guest_id));
      const whenLabel = payload[0]
        ? `${payload[0].schedule_date} ${payload[0].schedule_time}`
        : null;
      setCandidates((prev) => prev.filter((g) => !scheduledIds.has(g.id)));
      setSelected(new Set());
      setModalOpen(false);
      setSummary({
        total: count,
        sent: 0,
        skipped: 0,
        failed: 0,
        scheduled: count,
        scheduledForLabel: whenLabel,
      });
      toast("ok", whenLabel
        ? `📅 תוזמנו ${count} הצעות ספא ל-${whenLabel} (שעון ישראל)`
        : `📅 תוזמנו ${count} הצעות ספא`);
    } catch (err) {
      toast("err", "שגיאה בתזמון: " + (err?.message ?? String(err)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      marginTop: 8,
      background: "#FDF4FF",
      border: "1px solid #C026D3",
      borderRadius: 14,
      padding: "20px 22px",
      direction: "rtl",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#86198F", marginBottom: 4 }}>
            💆 הצעת ספא — בילוי יומי
          </div>
          <div style={{ fontSize: 12.5, color: "#701A75", lineHeight: 1.6, maxWidth: 520 }}>
            אורחי בילוי יומי ללא טיפול ספא ביום ההגעה — שליחה ידנית או מתוזמנת.
            בחרו ערוץ: <strong>מכשיר סוויטות</strong> (מיד) או <strong>Dream Bot</strong> (תבנית spa_upsell_daypass).
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#701A75" }}>תאריך הגעה:</label>
          <input
            type="date"
            value={arrivalDate}
            onChange={(e) => setArrivalDate(e.target.value)}
            disabled={loading || sending}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #D8B4FE", fontSize: 13 }}
          />
          <button
            type="button"
            onClick={loadAudience}
            disabled={loading || sending}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid #A21CAF",
              background: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}
          >
            {loading ? "⏳ טוען..." : "🔄 רענן רשימה"}
          </button>
        </div>
      </div>

      {loadError && (
        <div style={{
          background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
          padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 12,
        }}>
          ❌ שגיאה בטעינה: {loadError}
        </div>
      )}

      {summary && (
        <div style={{
          background: "#F3E8FF", border: "1px solid #A21CAF", borderRadius: 8,
          padding: "8px 12px", color: "#701A75", fontSize: 12.5, marginBottom: 12,
        }}>
          {summary.scheduled
            ? `📅 תוזמנו ${summary.scheduled} לשליחה${summary.scheduledForLabel ? ` ב-${summary.scheduledForLabel}` : ""} (cron)`
            : `✅ נשלחו ${summary.sent} · דולגו ${summary.skipped} · נכשלו ${summary.failed} מתוך ${summary.total}`}
        </div>
      )}

      {sending && progress && (
        <div style={{ fontSize: 12.5, color: "#701A75", marginBottom: 10 }}>
          ⏳ שולח {progress.current}/{progress.total}...
        </div>
      )}

      {!loading && !loadError && candidates.length === 0 && (
        <div style={{
          padding: "16px 14px", borderRadius: 10, background: "#fff",
          border: "1px dashed #D8B4FE", color: "#701A75", fontSize: 13, lineHeight: 1.55,
        }}>
          אין אורחי בילוי יומי ללא ספא לתאריך {arrivalDate}.
          <br />
          <span style={{ fontSize: 12, color: "#9D174D" }}>
            ודאו שסנכרנתם Doc 1 (מצב «ספא סוויטות בלבד») או שפרופילי בילוי יומי קיימים עם תאריך הגעה נכון.
          </span>
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={toggleAll} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 8,
              border: "1px solid #A21CAF", background: "#fff", cursor: "pointer",
            }}>
              {selected.size === candidates.length ? "נקה בחירה" : "בחר הכל"}
            </button>
            <span style={{ fontSize: 12, color: "#701A75" }}>
              {selected.size} נבחרו מתוך {candidates.length}
            </span>
          </div>
          <div style={{
            maxHeight: 280, overflowY: "auto", border: "1px solid #E9D5FF",
            borderRadius: 10, background: "#fff", marginBottom: 12,
          }}>
            {candidates.map((g) => (
              <label key={g.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                borderBottom: "1px solid #F3E8FF", fontSize: 13, cursor: "pointer",
              }}>
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} />
                <span style={{ fontWeight: 600, flex: 1 }}>{g.name || "—"}</span>
                <span style={{ color: "#A21CAF", fontSize: 12 }}>{g.phone}</span>
                {g.room && <span style={{ color: "#9D174D", fontSize: 11 }}>{g.room}</span>}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { if (selected.size > 0) setModalOpen(true); }}
            disabled={sending || selected.size === 0}
            style={{
              padding: "10px 20px", borderRadius: 10, border: "none",
              background: sending || selected.size === 0 ? "#E9D5FF" : "#A21CAF",
              color: "#fff", fontWeight: 800, fontSize: 14,
              cursor: sending || selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            {sending ? "⏳ מבצע..." : `💆 שלח / תזמן הצעת ספא ל-${selected.size} אורחים`}
          </button>
        </>
      )}

      {modalOpen && (
        <SpaUpsellConfirmModal
          targets={targets}
          scriptText={scriptText}
          pulseSeconds={SPA_UPSELL_SEND_PULSE_MS / 1000}
          sending={sending}
          metaTemplateStatus={metaTemplateStatus}
          onClose={() => { if (!sending) setModalOpen(false); }}
          onSendNow={handleSendNow}
          onSchedule={handleSchedule}
        />
      )}
    </div>
  );
}
