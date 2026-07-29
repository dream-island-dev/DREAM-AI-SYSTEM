// Spa upsell command center — send offers + track acceptance leads (day-pass).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import SpaUpsellConfirmModal from "./SpaUpsellConfirmModal";
import {
  fetchSpaUpsellAudience,
  israelTodayYmd,
  SPA_UPSELL_CHANNEL_WHAPI,
  SPA_UPSELL_META_TEMPLATE,
} from "../utils/spaUpsellAudience";
import {
  buildInboxDeepLink,
  buildSpaBoardDeepLink,
  buildSpaUpsellStaffCopy,
  fetchSpaUpsellLeads,
  fetchSpaUpsellSentCount,
  fmtLeadTime,
  mergePastedSpaUpsellContacts,
  spaUpsellScriptToWhapiTemplate,
} from "../utils/spaUpsellHub";
import { createDaypassGuestsBatch } from "../utils/daypassGuestCreate";
import { isSpaUpsellEligible } from "../utils/spaUpsellAudience";

const BATCH_POLL_INTERVAL_MS = 4000;
const BATCH_POLL_MAX_ATTEMPTS = 150;

const TAB_SEND = "send";
const TAB_LEADS = "leads";

const cardStyle = {
  background: "#fff",
  border: "1px solid #E9D5FF",
  borderRadius: 12,
  padding: "14px 16px",
  minWidth: 120,
};

export default function SpaUpsellHub({ initialDate, onToast }) {
  const [activeTab, setActiveTab] = useState(TAB_SEND);
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
  const [sentCount, setSentCount] = useState(0);

  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);

  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState(null);
  const [pasteMerging, setPasteMerging] = useState(false);
  const [pasteCreating, setPasteCreating] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const toast = useCallback((type, msg) => onToast?.(msg, type), [onToast]);

  const loadAudience = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setLoadError(null);
    setSummary(null);
    try {
      const [{ guests, error }, scriptRes, tmplRes, sentN] = await Promise.all([
        fetchSpaUpsellAudience(supabase, { arrivalDate }),
        supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", "spa_upsell_daypass")
          .maybeSingle(),
        supabase.functions.invoke("get-wa-templates", { body: { all: true } }),
        fetchSpaUpsellSentCount(supabase, arrivalDate),
      ]);
      if (error) throw error;
      setCandidates(guests);
      setSelected(new Set(guests.map((g) => g.id)));
      setScriptText(scriptRes.data?.message_text ?? "");
      const templates = tmplRes.data?.templates ?? [];
      const spaPkg = templates.find((t) => t.name === SPA_UPSELL_META_TEMPLATE);
      setMetaTemplateStatus(spaPkg?.status ?? null);
      setSentCount(sentN);
    } catch (e) {
      const msg = e?.message ?? String(e);
      setLoadError(msg);
      setCandidates([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [arrivalDate]);

  const loadLeads = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLeadsLoading(true);
    const { leads: rows, error } = await fetchSpaUpsellLeads(supabase, arrivalDate);
    if (error) toast("err", error.message);
    else setLeads(rows);
    setLeadsLoading(false);
  }, [arrivalDate, toast]);

  const refreshAll = useCallback(async () => {
    await loadAudience();
    await loadLeads();
  }, [loadAudience, loadLeads]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("spa-upsell-hub-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_alerts" }, () => {
        loadLeads();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadLeads]);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === candidates.length ? new Set() : new Set(candidates.map((g) => g.id)),
    );
  };

  const targets = candidates.filter((g) => selected.has(g.id));
  const pendingLeads = leads.length;

  const pollBatch = useCallback((batchId, total) => {
    let attempts = 0;
    const tick = async () => {
      if (!mountedRef.current) return;
      attempts += 1;
      const { data: jobs, error } = await supabase
        .from("whapi_outbound_jobs")
        .select("phone, status")
        .eq("batch_id", batchId);
      if (error) {
        setSending(false);
        setProgress(null);
        toast("err", `שגיאה במעקב: ${error.message}`);
        return;
      }
      const rows = jobs ?? [];
      const done = rows.filter((j) => j.status === "sent" || j.status === "failed" || j.status === "cancelled");
      setProgress({ current: done.length, total });

      if (done.length < total && attempts < BATCH_POLL_MAX_ATTEMPTS) {
        setTimeout(tick, BATCH_POLL_INTERVAL_MS);
        return;
      }

      const sentIds = new Set(
        targets.filter((_, i) => rows[i]?.status === "sent").map((g) => g.id),
      );
      if (rows.length > 0 && rows.every((j) => j.status === "sent")) {
        targets.forEach((g) => sentIds.add(g.id));
      }

      setCandidates((prev) => prev.filter((g) => !sentIds.has(g.id)));
      setSelected(new Set());
      setSending(false);
      setProgress(null);
      setModalOpen(false);
      const sentN = rows.filter((j) => j.status === "sent").length;
      setSummary({
        total: rows.length,
        sent: sentN,
        skipped: 0,
        failed: rows.filter((j) => j.status === "failed").length,
      });
      if (sentN > 0) {
        toast("ok", `💆 נשלחו ${sentN} הצעות ספא (מכשיר הסוויטות)`);
        setSentCount((c) => c + sentN);
      }
      await loadLeads();
    };
    tick();
  }, [targets, toast, loadLeads]);

  const handleSendNow = async (forceChannel) => {
    if (!supabase || targets.length === 0) return;
    const channel = forceChannel || SPA_UPSELL_CHANNEL_WHAPI;

    if (channel === SPA_UPSELL_CHANNEL_WHAPI) {
      setSending(true);
      setSummary(null);
      setProgress({ current: 0, total: targets.length });
      const template = spaUpsellScriptToWhapiTemplate(scriptText);
      try {
        const { data, error } = await supabase.functions.invoke("whapi-bulk-dispatch", {
          body: {
            phones: targets.map((g) => ({ phone: g.phone, name: g.name })),
            message_template: template,
            trigger: "spa_upsell_daypass",
            source: "SpaUpsellHub",
          },
        });
        if (error || !data?.ok) {
          setSending(false);
          setProgress(null);
          toast("err", error?.message || data?.error || "שגיאה בתזמון השליחה");
          return;
        }
        pollBatch(data.batchId, data.queued ?? targets.length);
      } catch (e) {
        setSending(false);
        setProgress(null);
        toast("err", e?.message ?? "שגיאה בשליחה");
      }
      return;
    }

    setSending(true);
    setSummary(null);
    const results = [];
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
        await new Promise((r) => setTimeout(r, 2500));
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
      toast("ok", `💆 נשלחו ${sent} הצעות ספא (Dream Bot)`);
      setSentCount((c) => c + sent);
    }
    await loadLeads();
  };

  const handleSchedule = async (payload) => {
    if (!supabase || !payload?.length) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("staff_schedule_tasks_batch", { p_tasks: payload });
      if (error) throw error;
      const count = typeof data === "number" ? data : payload.length;
      const scheduledIds = new Set(payload.map((p) => p.guest_id));
      setCandidates((prev) => prev.filter((g) => !scheduledIds.has(g.id)));
      setSelected(new Set());
      setModalOpen(false);
      setSummary({ total: count, sent: 0, skipped: 0, failed: 0, scheduled: count });
      toast("ok", `📅 תוזמנו ${count} הצעות ספא`);
      setSentCount((c) => c + count);
    } catch (err) {
      toast("err", "שגיאה בתזמון: " + (err?.message ?? String(err)));
    } finally {
      setSending(false);
    }
  };

  const handleParsePaste = async () => {
    if (!pasteText.trim()) {
      toast("err", "אין שורות לייבוא");
      return;
    }
    setPasteMerging(true);
    try {
      const result = await mergePastedSpaUpsellContacts(supabase, pasteText, arrivalDate);
      setPastePreview(result);
      if (result.merged.length === 0 && result.notFound.length === 0) {
        toast("err", "לא נמצאו שורות תקינות");
      }
    } catch (e) {
      toast("err", e?.message ?? "שגיאה בבדיקה");
    } finally {
      setPasteMerging(false);
    }
  };

  const addMergedPasteRows = (mergedRows) => {
    if (!mergedRows?.length) return 0;
    const existingIds = new Set(candidates.map((c) => c.id));
    const toAdd = mergedRows.filter((m) => !existingIds.has(m.id));
    if (!toAdd.length) return 0;
    setCandidates((prev) => [...prev, ...toAdd]);
    setSelected((prev) => {
      const next = new Set(prev);
      toAdd.forEach((m) => next.add(m.id));
      return next;
    });
    return toAdd.length;
  };

  const handleImportPaste = () => {
    if (!pastePreview?.merged?.length) return;
    const added = addMergedPasteRows(pastePreview.merged);
    if (added > 0) {
      toast("ok", `נוספו ${added} אורחים מההדבקה`);
      setPasteText("");
      setPastePreview(null);
    } else {
      toast("err", "כל השורות כבר ברשימה");
    }
  };

  const handleCreateProfilesFromPaste = async () => {
    if (!supabase || !pastePreview?.notFound?.length) return;
    setPasteCreating(true);
    try {
      const { created, errors } = await createDaypassGuestsBatch(
        supabase,
        pastePreview.notFound,
        arrivalDate,
      );
      if (errors.length > 0 && created.length === 0) {
        toast("err", `לא נוצרו פרופילים: ${errors[0].error}`);
        return;
      }
      const { data: freshGuests } = await supabase
        .from("guests")
        .select("id, phone, name, room_type, room, spa_date, spa_time, arrival_date, status, msg_spa_upsell_sent")
        .in("id", created.map((g) => g.id));
      const eligible = (freshGuests ?? [])
        .filter((g) => isSpaUpsellEligible(g, arrivalDate))
        .map((g) => ({ id: g.id, name: g.name, phone: g.phone, room: g.room, source: "paste" }));
      const added = addMergedPasteRows(eligible);
      const createdPhones = new Set(created.map((g) => g.phone));
      if (created.length > 0) {
        toast(
          errors.length > 0 ? "err" : "ok",
          `☀️ נוצרו ${created.length} פרופילי בילוי יומי${added ? ` · ${added} נוספו לרשימה` : ""}${errors.length ? ` · ${errors.length} נכשלו` : ""}`,
        );
      }
      setPastePreview((prev) => (prev ? {
        ...prev,
        notFound: prev.notFound.filter((r) => !createdPhones.has(r.phone)),
        merged: [...(prev.merged ?? []), ...eligible],
      } : null));
      if (created.length > 0 && errors.length === 0) {
        setPasteText("");
      }
    } catch (e) {
      toast("err", e?.message ?? "שגיאה ביצירת פרופילים");
    } finally {
      setPasteCreating(false);
    }
  };

  const resolveLead = async (leadId) => {
    if (!supabase) return;
    setResolvingId(leadId);
    const { data: authData } = await supabase.auth.getUser();
    const patch = {
      resolved: true,
      resolved_by: authData?.user?.id ?? null,
      resolved_at: new Date().toISOString(),
      resolution_notes: "סגור ממרכז הצעת ספא",
    };
    const { error } = await supabase.from("guest_alerts").update(patch).eq("id", leadId);
    setResolvingId(null);
    if (error) toast("err", error.message);
    else {
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      toast("ok", "✓ סומן כבוצע");
    }
  };

  const copyStaffList = async () => {
    const text = buildSpaUpsellStaffCopy(leads, arrivalDate);
    try {
      await navigator.clipboard.writeText(text);
      toast("ok", "📋 הרשימה הועתקה — שלח לצוות הספא");
    } catch {
      toast("err", "לא הצלחנו להעתיק");
    }
  };

  const kpiCards = useMemo(() => [
    { label: "ממתינים לתאום", value: pendingLeads, accent: "#7C3AED" },
    { label: "לשליחה עכשיו", value: candidates.length, accent: "#A21CAF" },
    { label: "הצעה נשלחה", value: sentCount, accent: "#6B21A8" },
  ], [pendingLeads, candidates.length, sentCount]);

  return (
    <div style={{
      marginTop: 8,
      background: "linear-gradient(165deg, #FDF4FF 0%, #FAF5FF 48%, #F3E8FF 100%)",
      border: "1px solid #C026D3",
      borderRadius: 16,
      padding: "22px 24px",
      direction: "rtl",
      boxShadow: "0 8px 32px rgba(124, 58, 237, 0.08)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: "#581C87", marginBottom: 6 }}>
            💆 מרכז הצעת ספא — בילוי יומי
          </div>
          <div style={{ fontSize: 12.5, color: "#6B21A8", lineHeight: 1.6, maxWidth: 560 }}>
            שליחה לתאריך הגעה · תשובות «אשמח לתאם» / «אשמח שיחזרו» נכנסות אוטומטית ל«ממתינים לתאום» + קבוצת בקשות אורחים.
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
            onClick={refreshAll}
            disabled={loading || sending}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid #A21CAF",
              background: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}
          >
            {loading ? "⏳..." : "🔄 רענן"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {kpiCards.map((k) => (
          <div key={k.label} style={{ ...cardStyle, borderRight: `4px solid ${k.accent}` }}>
            <div style={{ fontSize: 11, color: "#9D174D", fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.accent, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          { id: TAB_SEND, label: "📤 שליחת הצעה" },
          { id: TAB_LEADS, label: `📋 ממתינים לתאום${pendingLeads ? ` (${pendingLeads})` : ""}` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: activeTab === t.id ? "2px solid #A21CAF" : "1px solid #E9D5FF",
              background: activeTab === t.id ? "#F3E8FF" : "#fff",
              color: activeTab === t.id ? "#6B21A8" : "#701A75",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div style={{
          background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
          padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 12,
        }}>
          ❌ {loadError}
        </div>
      )}

      {summary && (
        <div style={{
          background: "#F3E8FF", border: "1px solid #A21CAF", borderRadius: 8,
          padding: "8px 12px", color: "#701A75", fontSize: 12.5, marginBottom: 12,
        }}>
          {summary.scheduled
            ? `📅 תוזמנו ${summary.scheduled} (cron)`
            : `✅ נשלחו ${summary.sent} · דולגו ${summary.skipped} · נכשלו ${summary.failed} מתוך ${summary.total}`}
        </div>
      )}

      {sending && progress && (
        <div style={{ fontSize: 12.5, color: "#701A75", marginBottom: 10 }}>
          ⏳ {progress.current}/{progress.total}...
        </div>
      )}

      {activeTab === TAB_SEND && (
        <>
          <details style={{ marginBottom: 14, background: "#fff", borderRadius: 10, padding: "10px 14px", border: "1px solid #E9D5FF" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#6B21A8" }}>
              ➕ הוסף נמענים בהעתק-הדבקה
            </summary>
            <div style={{ marginTop: 10 }}>
              <textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPastePreview(null); }}
                placeholder={"שם: +972 50-123-4567\nאו מספר בשורה"}
                rows={4}
                style={{
                  width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8,
                  border: "1px solid #D8B4FE", fontFamily: "inherit", fontSize: 12.5,
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={handleParsePaste} disabled={pasteMerging || pasteCreating} style={btnSecondary}>
                  {pasteMerging ? "בודק…" : "בדוק שורות"}
                </button>
                <button
                  type="button"
                  onClick={handleImportPaste}
                  disabled={!pastePreview?.merged?.length || pasteCreating}
                  style={btnPrimary}
                >
                  הוסף {pastePreview?.merged?.length ?? 0} לרשימה
                </button>
                {pastePreview?.notFound?.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCreateProfilesFromPaste}
                    disabled={pasteCreating}
                    style={{
                      ...btnSecondary,
                      borderColor: "#0e7490",
                      color: "#0e7490",
                      fontWeight: 800,
                    }}
                  >
                    {pasteCreating
                      ? "⏳ יוצר פרופילים…"
                      : `☀️ צור ${pastePreview.notFound.length} פרופילי בילוי יומי`}
                  </button>
                )}
              </div>
              {pastePreview && (
                <div style={{ fontSize: 12, marginTop: 8, color: "#6B21A8", lineHeight: 1.5 }}>
                  ✓ {pastePreview.merged.length} מתאימים
                  {pastePreview.ineligible?.length > 0 && (
                    <span style={{ color: "#B5600A" }}> · ⚠ {pastePreview.ineligible.length} לא מתאימים</span>
                  )}
                  {pastePreview.notFound?.length > 0 && (
                    <span style={{ color: "#C0392B" }}> · {pastePreview.notFound.length} ללא פרופיל — לחץ «צור פרופיל»</span>
                  )}
                  {pastePreview.invalid?.length > 0 && (
                    <span style={{ color: "#C0392B" }}> · {pastePreview.invalid.length} לא תקינים</span>
                  )}
                </div>
              )}
              {pastePreview?.notFound?.length > 0 && (
                <div style={{
                  marginTop: 10, padding: "10px 12px", borderRadius: 8,
                  background: "#ecfeff", border: "1px solid #A5E4EF", fontSize: 12.5,
                }}>
                  <div style={{ fontWeight: 700, color: "#0e7490", marginBottom: 6 }}>
                    ללא פרופיל ב-DB (ייווצרו כבילוי יומי · הגעה {arrivalDate})
                  </div>
                  {pastePreview.notFound.map((r) => (
                    <div key={r.phone} style={{ padding: "4px 0", color: "#155e75" }}>
                      {r.name || "—"} · {r.phone}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {!loading && !loadError && candidates.length === 0 && (
            <div style={{
              padding: "16px 14px", borderRadius: 10, background: "#fff",
              border: "1px dashed #D8B4FE", color: "#701A75", fontSize: 13, lineHeight: 1.55,
            }}>
              אין אורחי בילוי יומי ללא ספא לתאריך {arrivalDate}.
            </div>
          )}

          {candidates.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <button type="button" onClick={toggleAll} style={btnSecondary}>
                  {selected.size === candidates.length ? "נקה בחירה" : "בחר הכל"}
                </button>
                <span style={{ fontSize: 12, color: "#701A75" }}>
                  {selected.size} נבחרו מתוך {candidates.length}
                </span>
              </div>
              <div style={{
                maxHeight: 260, overflowY: "auto", border: "1px solid #E9D5FF",
                borderRadius: 10, background: "#fff", marginBottom: 12,
              }}>
                {candidates.map((g) => (
                  <label key={g.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: "1px solid #F3E8FF", fontSize: 13, cursor: "pointer",
                  }}>
                    <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} />
                    <span style={{ fontWeight: 600, flex: 1 }}>{g.name || "—"}</span>
                    {g.source === "paste" && (
                      <span style={{ fontSize: 10, color: "#7C3AED", fontWeight: 700 }}>הדבקה</span>
                    )}
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
                  padding: "12px 22px", borderRadius: 10, border: "none",
                  background: sending || selected.size === 0 ? "#E9D5FF" : "#A21CAF",
                  color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: sending || selected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {sending ? "⏳ מבצע..." : `💆 שלח / תזמן ל-${selected.size} אורחים`}
              </button>
            </>
          )}
        </>
      )}

      {activeTab === TAB_LEADS && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E9D5FF", padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#581C87" }}>
              אורחים שאישרו הצעת ספא — הגעה {arrivalDate}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={copyStaffList} disabled={!leads.length} style={btnSecondary}>
                📋 העתק לצוות
              </button>
              <a href={buildSpaBoardDeepLink()} target="_blank" rel="noopener noreferrer" style={btnLink}>
                🧭 לוח ספא
              </a>
            </div>
          </div>

          {leadsLoading ? (
            <div style={{ color: "#701A75", fontSize: 13 }}>טוען…</div>
          ) : leads.length === 0 ? (
            <div style={{
              padding: 20, textAlign: "center", color: "#9D174D", fontSize: 13,
              border: "1px dashed #D8B4FE", borderRadius: 10,
            }}>
              אין ממתינים לתאום לתאריך זה 🎉
              <br />
              <span style={{ fontSize: 12 }}>אחרי שליחת הצעה, תשובות «אשמח לתאם» יופיעו כאן אוטומטית.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    gap: 12, padding: "12px 14px", borderRadius: 10,
                    border: "1px solid #E9D5FF", borderRight: "4px solid #7C3AED",
                    background: "#FDF4FF", flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#581C87" }}>
                      {lead.guests?.name || "אורח"}
                      {lead.guests?.room ? ` · ${lead.guests.room}` : ""}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#4C1D95", marginTop: 4, lineHeight: 1.5 }}>
                      «{lead.message}»
                    </div>
                    <div style={{ fontSize: 11, color: "#9D174D", marginTop: 6 }}>
                      {fmtLeadTime(lead.created_at)} · {lead.phone}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <a
                      href={buildInboxDeepLink(lead.phone, lead.guests?.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={btnLink}
                    >
                      💬 שיחה
                    </a>
                    <button
                      type="button"
                      onClick={() => resolveLead(lead.id)}
                      disabled={resolvingId === lead.id}
                      style={btnPrimary}
                    >
                      {resolvingId === lead.id ? "…" : "✓ בוצע"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <SpaUpsellConfirmModal
          targets={targets}
          scriptText={scriptText}
          pulseSeconds={2.5}
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

const btnSecondary = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #A21CAF",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const btnPrimary = {
  ...btnSecondary,
  background: "#A21CAF",
  color: "#fff",
  border: "none",
  fontWeight: 700,
};

const btnLink = {
  ...btnSecondary,
  textDecoration: "none",
  display: "inline-block",
  color: "#6B21A8",
};
