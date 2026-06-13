// src/components/BroadcastDashboard.js  v3
// Smart Broadcast Module — manager selects an approved WhatsApp template,
// fills in variable values, then sends to a filtered subset of guests.
//
// All sends use type:"template" via the whatsapp-send edge function.
// Free-text sending has been removed — Meta requires approved templates for
// business-initiated messages outside the 24h customer-service window.
//
// Audience filters:
//   • סוג אורח:  all | suite | day_guest
//   • סטטוס:     all | expected | checked_in
//   • חלון הגעה: today+tomorrow | 7d | 30d | 90d | all
//
// Real-time sync: Supabase Realtime keeps allGuests live.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// Friendly label suggestions for template variables {{1}}, {{2}}, …
const VAR_LABELS = ["שם אורח", "מספר חדר", "תאריך הגעה", "סוג חדר", "שעת הגעה"];

// ── Arrival-window options ───────────────────────────────────────────────────
const ARRIVAL_WINDOWS = [
  { value: "1",   label: "היום + מחר" },
  { value: "7",   label: "7 ימים קדימה" },
  { value: "30",  label: "30 יום קדימה" },
  { value: "90",  label: "90 יום קדימה" },
  { value: "all", label: "כל האורחים" },
];

function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function BroadcastDashboard({ user }) {
  // ── Top-level tab ─────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState("broadcast"); // "broadcast" | "templates"

  // ── Data ──────────────────────────────────────────────────────────────────
  const [allGuests,   setAllGuests]   = useState([]);
  const [deptMap,     setDeptMap]     = useState({});
  const [dataLoading, setDataLoading] = useState(true);
  const [toast,       setToast]       = useState(null);

  // ── WA Templates (fetched from Meta via edge function) ────────────────────
  const [waTemplates,      setWaTemplates]      = useState([]);
  const [allMetaTemplates, setAllMetaTemplates] = useState([]); // all statuses for manager
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingAllTmpls,  setLoadingAllTmpls]  = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null); // { name, bodyText, varCount }
  const [templateVarValues,setTemplateVarValues]= useState([]);   // string[] for {{1}}, {{2}}…

  // ── Template Manager state ─────────────────────────────────────────────────
  const [showCreateForm,   setShowCreateForm]   = useState(false);
  const [newTmpl, setNewTmpl] = useState({
    name: "", language: "he", category: "MARKETING", body: "", header: "", footer: "",
  });
  const [creating, setCreating] = useState(false);

  // ── Audience filters ──────────────────────────────────────────────────────
  const [filterGuest,  setFilterGuest]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDept,   setFilterDept]   = useState("all");
  const [filterWindow, setFilterWindow] = useState("all");

  // ── Send state ────────────────────────────────────────────────────────────
  const [isSending,    setIsSending]    = useState(false);
  const [progress,     setProgress]     = useState(null);
  const [sendingOneId, setSendingOneId] = useState(null);
  const abortRef = useRef(false);

  // ── Send mode: template | free_text ──────────────────────────────────────
  const [sendMode,    setSendMode]    = useState("template");
  const [freeTextMsg, setFreeTextMsg] = useState("");

  // ── Quick Send state ──────────────────────────────────────────────────────
  const [quickSending, setQuickSending] = useState(false);
  const [quickResult,  setQuickResult]  = useState(null);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Fetch guests + manager departments ───────────────────────────────────
  const fetchGuests = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setDataLoading(false); return; }
    setDataLoading(true);
    try {
      const { data: guests, error } = await supabase
        .from("guests")
        .select("id, name, phone, room, room_type, arrival_date, status, manager_id")
        .order("arrival_date", { ascending: true });

      if (error) throw new Error(error.message);
      const rows = guests ?? [];
      setAllGuests(rows);

      const managerIds = [...new Set(rows.map((g) => g.manager_id).filter(Boolean))];
      if (managerIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, department")
          .in("id", managerIds);
        const map = {};
        (profiles ?? []).forEach((p) => { map[p.id] = p.department; });
        setDeptMap(map);
      }
    } catch (err) {
      showToast("err", "שגיאה בטעינת אורחים: " + (err?.message ?? err));
    } finally {
      setDataLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  // ── Fetch approved WA templates from Meta (via edge function) ─────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingTemplates(true);
    supabase.functions
      .invoke("get-wa-templates")
      .then(({ data, error }) => {
        if (error || !data?.ok) {
          console.warn("[BroadcastDashboard] WA templates fetch failed:", data?.error ?? error?.message);
          return;
        }
        // Only approved, exclude hello_world (test-only template)
        setWaTemplates(
          (data.templates ?? []).filter(
            (w) =>
              w.name !== "hello_world" &&
              (w.status == null || String(w.status).toUpperCase() === "APPROVED")
          )
        );
      })
      .finally(() => setLoadingTemplates(false));
  }, []);

  // ── Fetch ALL Meta templates (for manager tab) ───────────────────────────
  const fetchAllMetaTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingAllTmpls(true);
    try {
      // Pass all=true in the body so the edge function returns all statuses
      const { data, error } = await supabase.functions.invoke("get-wa-templates", {
        body: { all: true },
      });
      if (error) throw new Error(error.message);
      const templates = data?.templates ?? [];
      setAllMetaTemplates(templates);
    } catch (err) {
      showToast("err", "שגיאה בטעינת תבניות: " + (err?.message ?? err));
    } finally {
      setLoadingAllTmpls(false);
    }
  }, [showToast]);

  // Fetch all templates when switching to manager tab
  useEffect(() => {
    if (mainTab === "templates") fetchAllMetaTemplates();
  }, [mainTab, fetchAllMetaTemplates]);

  // ── Create new Meta template ──────────────────────────────────────────────
  const handleCreateTemplate = useCallback(async () => {
    if (!newTmpl.name.trim()) return showToast("err", "נא להזין שם תבנית");
    if (!newTmpl.body.trim()) return showToast("err", "נא להזין גוף הודעה");
    if (!isSupabaseConfigured || !supabase) return;

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-wa-template", {
        body: {
          name:     newTmpl.name.trim().toLowerCase().replace(/\s+/g, "_"),
          language: newTmpl.language,
          category: newTmpl.category,
          body:     newTmpl.body.trim(),
          header:   newTmpl.header.trim() || undefined,
          footer:   newTmpl.footer.trim() || undefined,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      showToast("ok", `✅ תבנית "${newTmpl.name}" נשלחה לאישור Meta! בדרך כלל מאושרת תוך 1-3 שעות.`);
      setNewTmpl({ name: "", language: "he", category: "MARKETING", body: "", header: "", footer: "" });
      setShowCreateForm(false);
      // Refresh the list
      setTimeout(() => fetchAllMetaTemplates(), 1500);
    } catch (err) {
      showToast("err", "שגיאה ביצירת תבנית: " + (err?.message ?? err));
    } finally {
      setCreating(false);
    }
  }, [newTmpl, showToast, fetchAllMetaTemplates]);

  // ── Supabase Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("broadcast-guests-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, (payload) => {
        if (payload.eventType === "UPDATE") {
          setAllGuests((prev) =>
            prev.map((g) => String(g.id) === String(payload.new.id) ? { ...g, ...payload.new } : g)
          );
        } else if (payload.eventType === "INSERT") {
          setAllGuests((prev) => {
            if (prev.some((g) => String(g.id) === String(payload.new.id))) return prev;
            return [...prev, payload.new].sort((a, b) =>
              (a.arrival_date ?? "").localeCompare(b.arrival_date ?? "")
            );
          });
        } else if (payload.eventType === "DELETE") {
          setAllGuests((prev) => prev.filter((g) => String(g.id) !== String(payload.old.id)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Compute filtered audience ─────────────────────────────────────────────
  const today = localISO(0);
  const filteredGuests = allGuests.filter((g) => {
    if (filterWindow !== "all" && g.status !== "checked_in") {
      const days = parseInt(filterWindow, 10);
      const cutoff = localISO(days);
      if (!g.arrival_date || g.arrival_date < today || g.arrival_date > cutoff) return false;
    }
    if (filterGuest === "suite"     && g.room_type === "day_guest") return false;
    if (filterGuest === "day_guest" && g.room_type !== "day_guest") return false;
    if (filterStatus !== "all" && g.status !== filterStatus) return false;
    if (filterDept !== "all") {
      if (deptMap[g.manager_id] !== filterDept) return false;
    }
    return true;
  });

  const checkedInInAudience = filteredGuests.filter((g) => g.status === "checked_in").length;
  const sendableGuests = filteredGuests.filter((g) => g.phone);
  const noPhoneCount   = filteredGuests.length - sendableGuests.length;
  const availableDepts = [...new Set(
    allGuests.map((g) => deptMap[g.manager_id]).filter(Boolean)
  )].sort();

  // ── Template selection ────────────────────────────────────────────────────
  function handleSelectTemplate(name) {
    const tmpl = waTemplates.find((t) => t.name === name) ?? null;
    setSelectedTemplate(tmpl);
    setTemplateVarValues(tmpl ? Array(tmpl.varCount).fill("") : []);
  }

  // ── Broadcast send loop ───────────────────────────────────────────────────
  const handleBroadcast = useCallback(async () => {
    if (sendMode === "template") {
      if (!selectedTemplate) return showToast("err", "נא לבחור תבנית הודעה");
      if (selectedTemplate.varCount > 0 && templateVarValues.some((v) => !v.trim()))
        return showToast("err", "נא למלא את כל שדות המשתנים");
    } else {
      if (!freeTextMsg.trim()) return showToast("err", "נא להקליד הודעה");
    }
    if (!sendableGuests.length)
      return showToast("err", "אין אורחים עם מספר טלפון בקהל זה");
    if (!isSupabaseConfigured || !supabase)
      return showToast("err", "Supabase לא מחובר");

    setIsSending(true);
    abortRef.current = false;
    setProgress({ current: 0, total: sendableGuests.length, errors: 0, done: false });

    let successCount = 0;
    let errorCount   = 0;

    for (let i = 0; i < sendableGuests.length; i++) {
      if (abortRef.current) break;

      const guest = sendableGuests[i];
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: sendMode === "template"
            ? { trigger: "broadcast", guestId: guest.id, waTemplateName: selectedTemplate.name, templateVariables: templateVarValues }
            : { trigger: "inbox_reply", phone: guest.phone, message: freeTextMsg },
        });
        if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
        if (!data?.ok) throw new Error(data?.error ?? "שליחת ההודעה נכשלה");
        successCount++;
      } catch (err) {
        errorCount++;
        console.warn("[broadcast] guest", guest.id, guest.name, "—", err?.message ?? err);
      }

      setProgress({ current: i + 1, total: sendableGuests.length, errors: errorCount, done: false });

      if (i < sendableGuests.length - 1 && !abortRef.current) {
        await sleep(200);
      }
    }

    const aborted = abortRef.current;
    setProgress({ current: successCount + errorCount, total: sendableGuests.length, errors: errorCount, done: true, aborted });
    setIsSending(false);

    if (!aborted) {
      showToast(
        errorCount === 0 ? "ok" : "warn",
        `שליחה הסתיימה: ${successCount} הצליחו${errorCount > 0 ? `, ${errorCount} נכשלו` : ""}`
      );
    }
  }, [sendMode, selectedTemplate, templateVarValues, freeTextMsg, sendableGuests, showToast]);

  const handleCancel = () => { abortRef.current = true; };

  // ── Quick Send: dream_arrival_tomorrow to tomorrow's guests ───────────────
  const handleQuickSendTomorrow = useCallback(async () => {
    const tomorrow = localISO(1);
    const targets = allGuests.filter((g) => g.phone && g.arrival_date === tomorrow);
    if (!targets.length) return showToast("err", "אין אורחים מחר עם מספר טלפון");
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");

    setQuickSending(true);
    setQuickResult(null);
    let ok = 0, fail = 0;

    for (const guest of targets) {
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: {
            trigger: "broadcast",
            guestId: guest.id,
            waTemplateName: "dream_arrival_tomorrow",
            templateVariables: [String(guest.name ?? "")],
          },
        });
        if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "failed");
        ok++;
      } catch (e) {
        fail++;
        console.warn("[quickSend] failed for", guest.name, e?.message);
      }
      await sleep(300);
    }

    setQuickSending(false);
    setQuickResult({ ok, fail, total: targets.length });
    showToast(fail === 0 ? "ok" : "warn",
      `📤 נשלח ל-${ok} אורחים מחר${fail > 0 ? ` (${fail} נכשלו)` : " ✅"}`);
  }, [allGuests, showToast]);

  // ── Send to a single guest (uses selected template) ───────────────────────
  const sendToOne = useCallback(async (guest) => {
    if (sendMode === "template" && !selectedTemplate)
      return showToast("err", "נא לבחור תבנית הודעה תחילה");
    if (sendMode === "free_text" && !freeTextMsg.trim())
      return showToast("err", "נא להקליד הודעה תחילה");
    if (!guest.phone) return showToast("err", `ל${guest.name} אין מספר טלפון`);
    setSendingOneId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: sendMode === "template"
          ? { trigger: "broadcast", guestId: guest.id, waTemplateName: selectedTemplate.name, templateVariables: templateVarValues }
          : { trigger: "inbox_reply", phone: guest.phone, message: freeTextMsg },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שגיאה בשליחה");
      showToast("ok", `✅ נשלח ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
    } catch (err) {
      showToast("err", `שגיאה: ${err?.message ?? err}`);
    } finally {
      setSendingOneId(null);
    }
  }, [sendMode, selectedTemplate, templateVarValues, freeTextMsg, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────
  const pct = progress
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  const sendReady = sendableGuests.length > 0 && (
    sendMode === "template"
      ? !!selectedTemplate && (selectedTemplate.varCount === 0 || templateVarValues.every((v) => v.trim()))
      : freeTextMsg.trim().length > 0
  );

  // ── Template Manager render ───────────────────────────────────────────────
  const STATUS_META = {
    APPROVED: { bg: "#E8F5EF", color: "#1A7A4A", border: "#1A7A4A", label: "✅ מאושרת" },
    PENDING:  { bg: "#FFF8E1", color: "#B5600A", border: "#F59E0B", label: "⏳ ממתינה" },
    REJECTED: { bg: "#FFF0EE", color: "#C0392B", border: "#C0392B", label: "❌ נדחתה" },
    PAUSED:   { bg: "#F0F0F0", color: "#555",    border: "#aaa",    label: "⏸ מושהית" },
  };

  const renderTemplateManager = () => (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📋 ניהול תבניות WhatsApp</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            סנכרון עם Meta Business Manager — תבניות מאושרות בלבד ניתנות לשליחה
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={fetchAllMetaTemplates}
            disabled={loadingAllTmpls}
          >
            {loadingAllTmpls ? "⏳ מסנכרן..." : "🔄 סנכרן מ-Meta"}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            {showCreateForm ? "✕ ביטול" : "✨ צור תבנית חדשה"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="card" style={{ marginBottom: 20, border: "2px solid var(--gold)" }}>
          <div className="card-header">
            <div className="card-title">✨ תבנית חדשה — שליחה לאישור Meta</div>
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Info banner */}
            <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 8, background: "#EFF6FF", border: "1px solid #93C5FD", color: "#1E40AF", lineHeight: 1.6 }}>
              💡 <strong>Meta דורשת:</strong> שם תבנית — אותיות לועזיות קטנות + קו תחתון בלבד (לדוג׳ <code>dream_welcome</code>).
              משתנים בגוף ההודעה — <code style={{ background: "rgba(0,0,0,0.07)", padding: "1px 4px", borderRadius: 3 }}>{"{{"+"1"+"}}"}</code> <code style={{ background: "rgba(0,0,0,0.07)", padding: "1px 4px", borderRadius: 3 }}>{"{{"+"2"+"}}"}</code> וכן הלאה.
              לאחר שליחה, Meta מאשרת תוך כ-1–3 שעות.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>שם תבנית <span style={{ color: "#C0392B" }}>*</span></label>
                <input
                  type="text"
                  placeholder="dream_welcome_guest"
                  value={newTmpl.name}
                  onChange={(e) => setNewTmpl((p) => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                  style={{ direction: "ltr" }}
                />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>שפה</label>
                <select value={newTmpl.language} onChange={(e) => setNewTmpl((p) => ({ ...p, language: e.target.value }))}>
                  <option value="he">עברית (he)</option>
                  <option value="en_US">English (en_US)</option>
                  <option value="ar">عربي (ar)</option>
                  <option value="ru">Русский (ru)</option>
                </select>
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>קטגוריה</label>
                <select value={newTmpl.category} onChange={(e) => setNewTmpl((p) => ({ ...p, category: e.target.value }))}>
                  <option value="MARKETING">📣 MARKETING (שיווק)</option>
                  <option value="UTILITY">🔔 UTILITY (שירות)</option>
                  <option value="AUTHENTICATION">🔐 AUTHENTICATION (אימות)</option>
                </select>
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>כותרת (אופציונלי) — מוצגת מעל גוף ההודעה</label>
              <input
                type="text"
                placeholder="Dream Island 🌴"
                value={newTmpl.header}
                onChange={(e) => setNewTmpl((p) => ({ ...p, header: e.target.value }))}
              />
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>גוף ההודעה <span style={{ color: "#C0392B" }}>*</span></label>
              <textarea
                rows={4}
                placeholder={"היי {{1}}! ברוכים הבאים ל-Dream Island 🌴\nהחדר שלך מוכן ומחכה לך מ-15:00 🏨"}
                value={newTmpl.body}
                onChange={(e) => setNewTmpl((p) => ({ ...p, body: e.target.value }))}
                style={{ fontFamily: "Heebo, sans-serif", fontSize: 14, lineHeight: 1.6, resize: "vertical" }}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {newTmpl.body.length} תווים · {(newTmpl.body.match(/\{\{\d+\}\}/g) ?? []).length} משתנים
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>כותרת תחתונה (אופציונלי) — טקסט קטן מתחת להודעה</label>
              <input
                type="text"
                placeholder="Dream Island Resort · לא להשיב להודעה זו"
                value={newTmpl.footer}
                onChange={(e) => setNewTmpl((p) => ({ ...p, footer: e.target.value }))}
              />
            </div>

            {/* Live preview */}
            {newTmpl.body.trim() && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, letterSpacing: 0.5 }}>
                  תצוגה מקדימה:
                </div>
                <div style={{
                  background: "#E9FBE5", border: "1px solid #A8E6A3", borderRadius: "0 14px 14px 14px",
                  padding: "12px 14px", maxWidth: 340, fontSize: 13, lineHeight: 1.7,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                }}>
                  {newTmpl.header && <div style={{ fontWeight: 700, marginBottom: 6 }}>{newTmpl.header}</div>}
                  <div style={{ whiteSpace: "pre-wrap" }}>{newTmpl.body}</div>
                  {newTmpl.footer && <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>{newTmpl.footer}</div>}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setShowCreateForm(false)}>ביטול</button>
              <button
                className="btn btn-primary"
                onClick={handleCreateTemplate}
                disabled={creating || !newTmpl.name.trim() || !newTmpl.body.trim()}
              >
                {creating ? "⏳ שולח ל-Meta..." : "📤 שלח לאישור Meta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            תבניות ב-Meta ({allMetaTemplates.length})
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {allMetaTemplates.filter((t) => t.status === "APPROVED").length} מאושרות ·{" "}
            {allMetaTemplates.filter((t) => t.status === "PENDING").length} ממתינות ·{" "}
            {allMetaTemplates.filter((t) => t.status === "REJECTED").length} נדחו
          </div>
        </div>

        {loadingAllTmpls ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>⏳ טוען תבניות מ-Meta...</div>
        ) : allMetaTemplates.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div>לא נמצאו תבניות. לחץ "סנכרן מ-Meta" או צור תבנית חדשה.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {allMetaTemplates.map((tmpl, idx) => {
              const st = STATUS_META[tmpl.status] ?? STATUS_META.PENDING;
              return (
                <div key={tmpl.id ?? tmpl.name} style={{
                  padding: "16px 20px",
                  borderBottom: idx < allMetaTemplates.length - 1 ? "1px solid var(--border)" : "none",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <code style={{
                        fontFamily: "monospace", fontWeight: 800, fontSize: 14,
                        color: "var(--black)", direction: "ltr",
                      }}>{tmpl.name}</code>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {tmpl.language} · {tmpl.category}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                        background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                      }}>
                        {st.label}
                      </span>
                      {tmpl.status === "APPROVED" && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, color: "var(--gold-dark)", border: "1px solid var(--gold)" }}
                          onClick={() => {
                            setSelectedTemplate(tmpl);
                            setTemplateVarValues(Array(tmpl.varCount).fill(""));
                            setMainTab("broadcast");
                          }}
                        >
                          📣 שלח עכשיו ←
                        </button>
                      )}
                    </div>
                  </div>
                  {tmpl.bodyText && (
                    <div style={{
                      fontSize: 12, color: "#444", background: "var(--ivory)",
                      borderRadius: 8, padding: "8px 12px", lineHeight: 1.6,
                      maxHeight: 80, overflowY: "auto",
                      direction: tmpl.language === "he" || tmpl.language === "ar" ? "rtl" : "ltr",
                      textAlign: tmpl.language === "he" || tmpl.language === "ar" ? "right" : "left",
                    }}>
                      {tmpl.bodyText}
                    </div>
                  )}
                  {tmpl.rejectedReason && (
                    <div style={{ fontSize: 11, color: "#C0392B", background: "#FFF0EE", borderRadius: 6, padding: "6px 10px" }}>
                      ❌ סיבת דחייה: {tmpl.rejectedReason}
                    </div>
                  )}
                  {tmpl.varCount > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {tmpl.varCount} משתנ{tmpl.varCount === 1 ? "ה" : "ים"} ({Array.from({ length: tmpl.varCount }, (_, i) => `{{${i + 1}}}`).join(", ")})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Main tab switcher ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--border)", marginBottom: 20, gap: 4 }}>
        {[
          { key: "broadcast", label: "📣 שידור הודעות" },
          { key: "templates", label: "📋 ניהול תבניות" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setMainTab(key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 20px", fontSize: 14, fontWeight: mainTab === key ? 800 : 500,
            color: mainTab === key ? "var(--gold-dark)" : "var(--text-muted)",
            borderBottom: mainTab === key ? "2px solid var(--gold-dark)" : "2px solid transparent",
            marginBottom: -2, fontFamily: "Heebo, sans-serif",
          }}>{label}</button>
        ))}
      </div>

      {/* Toast — visible in both tabs */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok"   ? "#E8F5EF" : toast.type === "warn" ? "#FFF5E8" : "#FFF0EE",
          color:      toast.type === "ok"   ? "#1A7A4A" : toast.type === "warn" ? "#B5600A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : toast.type === "warn" ? "#B5600A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {mainTab === "templates" && renderTemplateManager()}

      {mainTab === "broadcast" && <div>
      {/* ── Quick Send Banner ────────────────────────────────────────────── */}
      {(() => {
        const tomorrow = localISO(1);
        const tomorrowGuests = allGuests.filter((g) => g.phone && g.arrival_date === tomorrow);
        if (!tomorrowGuests.length) return null;
        return (
          <div style={{
            background: "linear-gradient(135deg, #075E54 0%, #128C7E 100%)",
            borderRadius: 14, padding: "18px 24px", marginBottom: 20,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            boxShadow: "0 4px 20px rgba(7,94,84,0.25)", flexWrap: "wrap", gap: 12,
          }}>
            <div style={{ color: "white" }}>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
                📅 מחר מגיעים {tomorrowGuests.length} אורחים
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                שלח תבנית ברכה אוטומטית — dream_arrival_tomorrow
              </div>
              {quickResult && (
                <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>
                  {quickResult.fail === 0
                    ? `✅ נשלח בהצלחה ל-${quickResult.ok} אורחים!`
                    : `⚠️ הצליח: ${quickResult.ok} | נכשל: ${quickResult.fail}`}
                </div>
              )}
            </div>
            <button
              onClick={handleQuickSendTomorrow}
              disabled={quickSending}
              style={{
                background: quickSending ? "rgba(255,255,255,0.3)" : "white",
                color: "#075E54", border: "none", borderRadius: 10,
                padding: "12px 24px", fontWeight: 800, fontSize: 14,
                cursor: quickSending ? "not-allowed" : "pointer",
                fontFamily: "Heebo, sans-serif", whiteSpace: "nowrap",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}
            >
              {quickSending ? "⏳ שולח..." : `📤 שלח לכולם (${tomorrowGuests.length})`}
            </button>
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* ── LEFT: Audience Builder ──────────────────────────────────────── */}
        <div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-title">👥 בניית קהל</div>
              <button onClick={fetchGuests} disabled={dataLoading} className="btn btn-ghost btn-sm">
                {dataLoading ? "⏳" : "🔄"} רענן
              </button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>חלון הגעה</label>
                <select value={filterWindow} onChange={(e) => setFilterWindow(e.target.value)}>
                  {ARRIVAL_WINDOWS.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>סוג אורח</label>
                <select value={filterGuest} onChange={(e) => setFilterGuest(e.target.value)}>
                  <option value="all">כל האורחים</option>
                  <option value="suite">👑 סוויטות (לינה)</option>
                  <option value="day_guest">🏊 בילוי יומי</option>
                </select>
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>סטטוס</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">כל הסטטוסים</option>
                  <option value="expected">ממתין (טרם הגיע)</option>
                  <option value="checked_in">✅ צ׳ק-אין בוצע</option>
                </select>
              </div>

              {availableDepts.length > 1 && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>מחלקה</label>
                  <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                    <option value="all">כל המחלקות</option>
                    {availableDepts.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Audience summary */}
            <div style={{
              margin: "0 20px 20px", padding: 14, borderRadius: 10,
              background: sendableGuests.length > 0 ? "rgba(201,169,110,0.08)" : "var(--ivory)",
              border: `1px solid ${sendableGuests.length > 0 ? "var(--gold)" : "var(--border)"}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 22, color: sendableGuests.length > 0 ? "var(--gold-dark)" : "var(--text-muted)" }}>
                  {sendableGuests.length}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                  אורחים יקבלו הודעה
                </span>
              </div>
              {noPhoneCount > 0 && (
                <div style={{ fontSize: 11, color: "#B5600A", marginTop: 4 }}>
                  ⚠️ {noPhoneCount} אורחים ללא מספר טלפון (יוחסרו)
                </div>
              )}
              {checkedInInAudience > 0 && filterStatus === "all" && (
                <div style={{
                  marginTop: 8, padding: "8px 10px", borderRadius: 8,
                  background: "#FFF5E8", border: "1px solid #F59E0B", fontSize: 11, color: "#92400E",
                }}>
                  ⚠️ {checkedInInAudience} אורח/ים כבר עשו צ׳ק-אין.{" "}
                  <button
                    onClick={() => setFilterStatus("expected")}
                    style={{ background: "none", border: "none", color: "#D97706", fontWeight: 700, cursor: "pointer", fontSize: 11, padding: 0, fontFamily: "Heebo, sans-serif" }}
                  >הסר אותם ←</button>
                </div>
              )}
              {filteredGuests.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  {filteredGuests.slice(0, 3).map((g) => g.name).join(", ")}
                  {filteredGuests.length > 3 && ` ועוד ${filteredGuests.length - 3}...`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Message composer ─────────────────────────────────────── */}
        <div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-title">✉️ הודעה לשידור</div>
              {sendMode === "template" && loadingTemplates && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>⏳ טוען תבניות...</span>
              )}
            </div>

            {/* Mode tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 20px" }}>
              {[
                { key: "template",   label: "📋 תבנית מאושרת" },
                { key: "free_text",  label: "✏️ הודעה חופשית" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSendMode(key)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "10px 16px", fontSize: 13, fontWeight: sendMode === key ? 800 : 500,
                    color: sendMode === key ? "var(--gold-dark)" : "var(--text-muted)",
                    borderBottom: sendMode === key ? "2px solid var(--gold-dark)" : "2px solid transparent",
                    marginBottom: -1, fontFamily: "Heebo, sans-serif",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── Template mode ── */}
              {sendMode === "template" && (
                <>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>בחר תבנית</label>
                    {!loadingTemplates && waTemplates.length === 0 ? (
                      <div style={{
                        fontSize: 12, color: "#C0392B", padding: "10px 12px", borderRadius: 8,
                        background: "#FFF0EE", border: "1px solid #C0392B",
                      }}>
                        ⚠️ לא נמצאו תבניות מאושרות ב-Meta. בדוק שה-META_BUSINESS_ACCOUNT_ID מוגדר כ-Secret בסופאבייס.
                      </div>
                    ) : (
                      <select
                        value={selectedTemplate?.name ?? ""}
                        onChange={(e) => handleSelectTemplate(e.target.value)}
                        disabled={loadingTemplates}
                      >
                        <option value="">— בחר תבנית —</option>
                        {waTemplates.map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {selectedTemplate?.bodyText && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, letterSpacing: 0.5 }}>
                        תוכן התבנית:
                      </div>
                      <div style={{
                        background: "var(--ivory)", border: "1px solid var(--border)",
                        borderRadius: 10, padding: "12px 14px",
                        fontSize: 12, lineHeight: 1.7, color: "var(--black)",
                        direction: "ltr", textAlign: "left",
                        maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap",
                      }}>
                        {selectedTemplate.bodyText}
                      </div>
                    </div>
                  )}

                  {selectedTemplate && selectedTemplate.varCount > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.5 }}>
                        ערכי משתנים לכלל הקהל:
                      </div>
                      {templateVarValues.map((val, idx) => (
                        <div key={idx} className="form-field" style={{ marginBottom: 0 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                              background: "var(--gold)", color: "#1B3A32",
                              borderRadius: 5, padding: "1px 7px",
                              fontSize: 11, fontWeight: 800, fontFamily: "monospace",
                            }}>
                              {`{{${idx + 1}}}`}
                            </span>
                            {VAR_LABELS[idx] ?? `משתנה ${idx + 1}`}
                          </label>
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => {
                              const next = [...templateVarValues];
                              next[idx] = e.target.value;
                              setTemplateVarValues(next);
                            }}
                            placeholder={`ערך עבור {{${idx + 1}}}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {!selectedTemplate && !loadingTemplates && waTemplates.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "16px 0", fontStyle: "italic" }}>
                      בחר תבנית מאושרת כדי להמשיך
                    </div>
                  )}

                  {sendReady && sendMode === "template" && (
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: "#1A7A4A",
                      padding: "8px 12px", borderRadius: 8,
                      background: "#E8F5EF", border: "1px solid #1A7A4A",
                    }}>
                      ✅ מוכן לשליחה — {selectedTemplate.name}
                    </div>
                  )}
                </>
              )}

              {/* ── Free text mode ── */}
              {sendMode === "free_text" && (
                <>
                  <div style={{
                    fontSize: 12, padding: "10px 12px", borderRadius: 8,
                    background: "#FFF5E8", border: "1px solid #F59E0B", color: "#92400E",
                  }}>
                    ⚠️ הודעות חופשיות נשלחות רק בתוך חלון שירות 24 שעות מההודעה האחרונה של האורח. מחוץ לחלון — ההודעה תיכשל. להגעה לקהל רחב בחרו תבנית מאושרת.
                  </div>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>תוכן ההודעה</label>
                    <textarea
                      value={freeTextMsg}
                      onChange={(e) => setFreeTextMsg(e.target.value)}
                      placeholder="הקלד את ההודעה כאן..."
                      rows={5}
                      style={{ resize: "vertical", fontFamily: "Heebo, sans-serif", fontSize: 14, lineHeight: 1.6 }}
                    />
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "left", marginTop: 4 }}>
                      {freeTextMsg.length} תווים
                    </div>
                  </div>
                  {sendReady && (
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: "#1A7A4A",
                      padding: "8px 12px", borderRadius: 8,
                      background: "#E8F5EF", border: "1px solid #1A7A4A",
                    }}>
                      ✅ מוכן לשליחה — הודעה חופשית ל-{sendableGuests.length} אורחים
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Send section ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ padding: "20px 24px" }}>

          {!isSending && !progress?.done && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
                {sendableGuests.length === 0
                  ? "⚠️ אין אורחים מתאימים — שנה פילטרים"
                  : sendMode === "template" && !selectedTemplate
                  ? "⚠️ בחר תבנית כדי להתחיל"
                  : sendMode === "free_text" && !freeTextMsg.trim()
                  ? "⚠️ הקלד הודעה כדי להתחיל"
                  : `📤 מוכן לשלוח ל-${sendableGuests.length} אורחים`}
              </div>
              <button
                className="btn btn-primary"
                disabled={!sendReady || isSending || dataLoading}
                onClick={handleBroadcast}
                style={{ minWidth: 200, fontSize: 15, opacity: sendReady ? 1 : 0.5 }}
              >
                📣 שלח לכולם
              </button>
            </div>
          )}

          {/* Live progress bar */}
          {(isSending || (progress && !progress.done)) && progress && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--black)" }}>
                  שולח הודעה {progress.current} מתוך {progress.total}...
                </span>
                {progress.errors > 0 && (
                  <span style={{ fontSize: 12, color: "#C0392B", fontWeight: 600 }}>
                    {progress.errors} שגיאות
                  </span>
                )}
              </div>
              <div className="progress-bar" style={{ height: 10 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pct}% הושלם</span>
                <button className="btn btn-ghost btn-sm" onClick={handleCancel} style={{ color: "#C0392B" }}>
                  ⛔ עצור שליחה
                </button>
              </div>
            </div>
          )}

          {/* Done summary */}
          {progress?.done && (
            <div style={{
              padding: "16px 20px", borderRadius: 10,
              background: progress.errors === 0 ? "#E8F5EF" : "#FFF0EE",
              border: `1px solid ${progress.errors === 0 ? "#1A7A4A" : "#C0392B"}`,
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: progress.errors === 0 ? "#1A7A4A" : "#C0392B", marginBottom: 4 }}>
                {progress.aborted ? "⛔ שליחה הופסקה" : "✅ שליחה הסתיימה"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                נשלחו: {progress.current - progress.errors} · נכשלו: {progress.errors} · סה"כ: {progress.total}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setProgress(null); setIsSending(false); }}
                style={{ marginTop: 10 }}
              >
                ← שליחה חדשה
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Audience preview table ─────────────────────────────────────────── */}
      {filteredGuests.length > 0 && !isSending && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">
              תצוגה מקדימה של קהל ({filteredGuests.length} אורחים)
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 540 }}>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>טלפון</th>
                  <th>חדר</th>
                  <th>סוג</th>
                  <th>הגעה</th>
                  <th>סטטוס</th>
                  <th>שלח</th>
                </tr>
              </thead>
              <tbody>
                {filteredGuests.slice(0, 50).map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 700 }}>{g.name}</td>
                    <td style={{ direction: "ltr", fontSize: 13 }}>
                      {g.phone
                        ? <a href={`tel:${g.phone}`} style={{ color: "#2563EB", textDecoration: "none" }}>{g.phone}</a>
                        : <span style={{ color: "#C0392B", fontSize: 11 }}>חסר ✕</span>
                      }
                    </td>
                    <td style={{ fontSize: 13 }}>{g.room || "—"}</td>
                    <td>
                      {g.room_type === "suite"
                        ? <span style={{ color: "var(--gold-dark)", fontWeight: 700, fontSize: 12 }}>👑 סוויטה</span>
                        : g.room_type === "day_guest"
                        ? <span style={{ color: "#1D4ED8", fontSize: 12 }}>🏊 יומי</span>
                        : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{g.room_type || "standard"}</span>
                      }
                    </td>
                    <td style={{ direction: "ltr", fontSize: 13 }}>{g.arrival_date || "—"}</td>
                    <td>
                      <span className={`badge ${
                        g.status === "checked_in" ? "badge-green"
                        : g.status === "expected" ? "badge-blue"
                        : "badge-gray"
                      }`}>
                        {g.status || "—"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => sendToOne(g)}
                        disabled={!g.phone || !selectedTemplate || sendingOneId === g.id || isSending}
                        title={!selectedTemplate ? "בחר תבנית תחילה" : `שלח ל${g.name}`}
                        style={{
                          padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700,
                          border: "1px solid #22C55E", background: "#F0FDF4", color: "#15803D",
                          cursor: (!g.phone || !selectedTemplate || isSending) ? "default" : "pointer",
                          opacity: (!g.phone || !selectedTemplate) ? 0.3 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sendingOneId === g.id ? "⏳" : "📤 שלח"}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredGuests.length > 50 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, padding: 10 }}>
                      מוצגים 50 מתוך {filteredGuests.length} — הודעה תישלח לכולם
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>}{/* end broadcast tab */}
    </div>
  );
}
