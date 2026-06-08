// src/components/BroadcastDashboard.js  v2
// Smart Broadcast Module — manager composes a WhatsApp message and sends
// it to a filtered subset of guests.
//
// Dream Island booking model (two types only — no "standard rooms"):
//   • סוויטות   (suite)     — overnight VIP hospitality
//   • בילוי יומי (day_guest) — day-spa / day-use packages
//
// Audience filters:
//   • סוג אורח:  all | suite | day_guest
//   • סטטוס:     all | expected | checked_in
//   • חלון הגעה: today+tomorrow | 7d | 30d | 90d | all
//
// Real-time sync: Supabase Realtime (postgres_changes) keeps allGuests
// live — any check-in action in GuestDashboard is reflected immediately.
//
// Defensive targeting:
//   • When filterStatus=all, warns if checked-in guests are in audience
//   • Console.warn emitted per failed send during broadcast loop
//
// Message template supports dynamic placeholders:
//   {{guest_name}}, {{room}}, {{room_type}}, {{arrival_date}}
//   Resolved server-side per guest inside whatsapp-send/index.ts (broadcast trigger).
//
// Send loop:
//   For each filtered guest → invoke whatsapp-send (broadcast trigger) →
//   wait 200ms → next guest. Per-guest try/catch; failed sends counted separately.
//   Progress bar updates live: "שולח הודעה 4 מתוך 50..."
//
// Auth: guests are RLS-scoped — tactical managers see only their own rows;
//       GM / super_admin see all rows (join with profiles for department filter).

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Available placeholder tags displayed in the UI ────────────────────────────
const TEMPLATE_TAGS = [
  { tag: "{{guest_name}}",   label: "שם אורח" },
  { tag: "{{room}}",         label: "מספר חדר" },
  { tag: "{{room_type}}",    label: "סוג חדר" },
  { tag: "{{arrival_date}}", label: "תאריך הגעה" },
];

// ── Arrival-window options ───────────────────────────────────────────────────
const ARRIVAL_WINDOWS = [
  { value: "1",   label: "היום + מחר" },
  { value: "7",   label: "7 ימים קדימה" },
  { value: "30",  label: "30 יום קדימה" },
  { value: "90",  label: "90 יום קדימה" },
  { value: "all", label: "כל האורחים" },
];

// Local ISO date helper (avoids UTC-offset issues)
function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── sleep helper for the 200ms throttle ──────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function BroadcastDashboard({ user }) {
  // ── Data ──────────────────────────────────────────────────────────────────
  const [allGuests,    setAllGuests]    = useState([]);
  const [deptMap,      setDeptMap]      = useState({}); // manager_id → department
  const [dataLoading,  setDataLoading]  = useState(true);
  const [toast,        setToast]        = useState(null);

  // ── Audience filters ──────────────────────────────────────────────────────
  // filterGuest: uses room_type — the single source of truth for booking model
  const [filterGuest,  setFilterGuest]  = useState("all"); // all | suite | day_guest
  const [filterStatus, setFilterStatus] = useState("all"); // all | expected | checked_in
  const [filterDept,   setFilterDept]   = useState("all"); // all | department name
  const [filterWindow, setFilterWindow] = useState("7");   // arrival window in days

  // ── Compose ───────────────────────────────────────────────────────────────
  const [template, setTemplate] = useState("");
  const textareaRef = useRef(null);

  // ── Send state ────────────────────────────────────────────────────────────
  const [isSending,    setIsSending]    = useState(false);
  const [progress,     setProgress]     = useState(null);
  const [sendingOneId, setSendingOneId] = useState(null); // individual guest send
  // { current, total, errors, done }
  const abortRef = useRef(false); // lets the user cancel mid-broadcast

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
      // Fetch all guests visible to this user (RLS scopes tactical managers)
      const { data: guests, error } = await supabase
        .from("guests")
        .select("id, name, phone, room, room_type, arrival_date, status, manager_id")
        .order("arrival_date", { ascending: true });

      if (error) throw new Error(error.message);
      const rows = guests ?? [];
      setAllGuests(rows);

      // Fetch department labels for each unique manager
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

  // ── Supabase Realtime — keep allGuests live ───────────────────────────────
  // Any check-in / status change in GuestDashboard is reflected here instantly
  // without a manual refresh. Uses postgres_changes (WAL-based, no extra config).
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("broadcast-guests-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guests" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setAllGuests((prev) =>
              prev.map((g) =>
                String(g.id) === String(payload.new.id)
                  ? { ...g, ...payload.new }
                  : g
              )
            );
            if (process.env.NODE_ENV === "development") {
              console.info(
                "[BroadcastDashboard] Realtime UPDATE — guest",
                payload.new.id, payload.new.name,
                "→ status:", payload.new.status
              );
            }
          } else if (payload.eventType === "INSERT") {
            setAllGuests((prev) => {
              // Avoid duplicates if fetchGuests already added it
              if (prev.some((g) => String(g.id) === String(payload.new.id))) return prev;
              return [...prev, payload.new].sort((a, b) =>
                (a.arrival_date ?? "").localeCompare(b.arrival_date ?? "")
              );
            });
          } else if (payload.eventType === "DELETE") {
            setAllGuests((prev) =>
              prev.filter((g) => String(g.id) !== String(payload.old.id))
            );
          }
        }
      )
      .subscribe((status) => {
        if (process.env.NODE_ENV === "development") {
          console.info("[BroadcastDashboard] Realtime channel status:", status);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, []); // mount/unmount only — channel is self-maintaining

  // ── Compute filtered audience ─────────────────────────────────────────────
  const today = localISO(0);
  const filteredGuests = allGuests.filter((g) => {
    // Arrival window
    if (filterWindow !== "all") {
      const days = parseInt(filterWindow, 10);
      const cutoff = localISO(days);
      if (!g.arrival_date || g.arrival_date < today || g.arrival_date > cutoff) return false;
    }
    // Guest type — room_type is the canonical booking category
    // ('standard' legacy rows treated as suite/overnight for backward compat)
    if (filterGuest === "suite"     && g.room_type === "day_guest") return false;
    if (filterGuest === "day_guest" && g.room_type !== "day_guest") return false;
    // Status — live state after Realtime updates
    if (filterStatus !== "all" && g.status !== filterStatus) return false;
    // Department (via manager profile)
    if (filterDept !== "all") {
      const manDept = deptMap[g.manager_id];
      if (manDept !== filterDept) return false;
    }
    return true;
  });

  // Defensive: flag if checked-in guests will receive a broadcast
  const checkedInInAudience = filteredGuests.filter((g) => g.status === "checked_in").length;
  if (process.env.NODE_ENV === "development" && checkedInInAudience > 0 && filterStatus === "all") {
    console.warn(
      `[BroadcastDashboard] ⚠️ Audience includes ${checkedInInAudience} checked-in guest(s).`,
      "Set filterStatus='expected' to exclude them from pre-arrival sends."
    );
  }

  // Guests without a phone number can't be messaged
  const sendableGuests = filteredGuests.filter((g) => g.phone);
  const noPhoneCount   = filteredGuests.length - sendableGuests.length;

  // Unique department options for filter dropdown
  const availableDepts = [...new Set(
    allGuests.map((g) => deptMap[g.manager_id]).filter(Boolean)
  )].sort();

  // ── Insert tag into textarea at cursor ────────────────────────────────────
  const insertTag = useCallback((tag) => {
    const el = textareaRef.current;
    if (!el) { setTemplate((t) => t + tag); return; }
    const start = el.selectionStart ?? template.length;
    const end   = el.selectionEnd   ?? template.length;
    const next  = template.slice(0, start) + tag + template.slice(end);
    setTemplate(next);
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }, [template]);

  // ── Broadcast send loop ───────────────────────────────────────────────────
  const handleBroadcast = useCallback(async () => {
    if (!template.trim())           return showToast("err", "נא להזין תוכן הודעה");
    if (!sendableGuests.length)     return showToast("err", "אין אורחים עם מספר טלפון בקהל זה");
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");

    setIsSending(true);
    abortRef.current = false;
    setProgress({ current: 0, total: sendableGuests.length, errors: 0, done: false });

    let successCount = 0;
    let errorCount   = 0;

    for (let i = 0; i < sendableGuests.length; i++) {
      if (abortRef.current) break; // user pressed cancel

      const guest = sendableGuests[i];
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "broadcast", guestId: guest.id, messageTemplate: template },
        });
        // supabase.functions.invoke wraps non-2xx; real error is in data?.error
        if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
        if (!data?.ok) throw new Error(data?.error ?? "שליחת ההודעה נכשלה");
        successCount++;
      } catch (err) {
        errorCount++;
        console.warn("[broadcast] guest", guest.id, guest.name, "—", err?.message ?? err);
      }

      // Update live progress counter
      setProgress({
        current: i + 1,
        total:   sendableGuests.length,
        errors:  errorCount,
        done:    false,
      });

      // 200ms throttle between sends — Meta rate limit protection
      if (i < sendableGuests.length - 1 && !abortRef.current) {
        await sleep(200);
      }
    }

    const aborted = abortRef.current;
    setProgress({
      current: successCount + errorCount,
      total:   sendableGuests.length,
      errors:  errorCount,
      done:    true,
      aborted,
    });
    setIsSending(false);

    if (!aborted) {
      showToast(
        errorCount === 0 ? "ok" : "warn",
        `שליחה הסתיימה: ${successCount} הצליחו${errorCount > 0 ? `, ${errorCount} נכשלו` : ""}`
      );
    }
  }, [template, sendableGuests, showToast]);

  const handleCancel = () => { abortRef.current = true; };

  // ── Send to a single guest (uses current template) ────────────────────────
  const sendToOne = useCallback(async (guest) => {
    if (!template.trim()) return showToast("err", "נא להזין תוכן הודעה תחילה");
    if (!guest.phone)     return showToast("err", `ל${guest.name} אין מספר טלפון`);
    setSendingOneId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "broadcast", guestId: guest.id, messageTemplate: template },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שגיאה בשליחה");
      showToast("ok", `✅ נשלח ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
    } catch (err) {
      showToast("err", `שגיאה: ${err?.message ?? err}`);
    } finally {
      setSendingOneId(null);
    }
  }, [template, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────
  const pct = progress
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok"   ? "#E8F5EF"
                    : toast.type === "warn" ? "#FFF5E8"
                    :                          "#FFF0EE",
          color:      toast.type === "ok"   ? "#1A7A4A"
                    : toast.type === "warn" ? "#B5600A"
                    :                          "#C0392B",
          border: `1px solid ${
            toast.type === "ok" ? "#1A7A4A" : toast.type === "warn" ? "#B5600A" : "#C0392B"
          }`,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* ── LEFT: Audience Builder ──────────────────────────────────────── */}
        <div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-title">👥 בניית קהל</div>
              <button
                onClick={fetchGuests}
                disabled={dataLoading}
                className="btn btn-ghost btn-sm"
              >
                {dataLoading ? "⏳" : "🔄"} רענן
              </button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Arrival window */}
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>חלון הגעה</label>
                <select
                  value={filterWindow}
                  onChange={(e) => setFilterWindow(e.target.value)}
                >
                  {ARRIVAL_WINDOWS.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>

              {/* Guest type — Dream Island: Suites or Daily Experience only */}
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>סוג אורח</label>
                <select value={filterGuest} onChange={(e) => setFilterGuest(e.target.value)}>
                  <option value="all">כל האורחים</option>
                  <option value="suite">👑 סוויטות (לינה)</option>
                  <option value="day_guest">🏊 בילוי יומי</option>
                </select>
              </div>

              {/* Status — live values via Realtime sync */}
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>סטטוס</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">כל הסטטוסים</option>
                  <option value="expected">ממתין (טרם הגיע)</option>
                  <option value="checked_in">✅ צ׳ק-אין בוצע</option>
                </select>
              </div>

              {/* Department (visible only if multiple depts exist) */}
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
              margin: "0 20px 20px",
              padding: 14,
              borderRadius: 10,
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
              {/* Defensive warning: checked-in guests in pre-arrival broadcast */}
              {checkedInInAudience > 0 && filterStatus === "all" && (
                <div style={{
                  marginTop: 8, padding: "8px 10px", borderRadius: 8,
                  background: "#FFF5E8", border: "1px solid #F59E0B", fontSize: 11, color: "#92400E",
                }}>
                  ⚠️ {checkedInInAudience} אורח/ים כבר עשו צ׳ק-אין בקהל זה.
                  {" "}<button
                    onClick={() => setFilterStatus("expected")}
                    style={{
                      background: "none", border: "none", color: "#D97706",
                      fontWeight: 700, cursor: "pointer", fontSize: 11, padding: 0,
                      fontFamily: "Heebo, sans-serif",
                    }}
                  >הסר אותם ←</button>
                </div>
              )}
              {filteredGuests.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {/* Preview: first 3 names */}
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {filteredGuests.slice(0, 3).map((g) => g.name).join(", ")}
                    {filteredGuests.length > 3 && ` ועוד ${filteredGuests.length - 3}...`}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Message Composer ─────────────────────────────────────── */}
        <div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-title">✍️ עריכת הודעה</div>
            </div>
            <div style={{ padding: "16px 20px" }}>

              {/* Tag inserter */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>
                  הכנס תגית דינמית:
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {TEMPLATE_TAGS.map(({ tag, label }) => (
                    <button
                      key={tag}
                      onClick={() => insertTag(tag)}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template textarea */}
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>תוכן ההודעה</label>
                <textarea
                  ref={textareaRef}
                  rows={7}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder={
                    "לדוגמה:\n" +
                    "שלום {{guest_name}}, 👋\n" +
                    "אנו שמחים לקבל את פניך בדרים איילנד!\n" +
                    "חדרך {{room}} מוכן לקבלך. מחכים לך!"
                  }
                  style={{ resize: "vertical", fontFamily: "Heebo, sans-serif", direction: "rtl" }}
                />
              </div>

              {/* Character count + note */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                <span>{template.length} תווים</span>
                <span>תגיות יוחלפו בנתוני כל אורח בנפרד</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Send section ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ padding: "20px 24px" }}>

          {/* Pre-send summary row */}
          {!isSending && !progress?.done && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 12,
            }}>
              <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
                {sendableGuests.length > 0
                  ? `📤 מוכן לשלוח ל-${sendableGuests.length} אורחים`
                  : "⚠️ אין אורחים מתאימים — שנה פילטרים"}
              </div>
              <button
                className="btn btn-primary"
                disabled={!template.trim() || !sendableGuests.length || isSending || dataLoading}
                onClick={handleBroadcast}
                style={{
                  minWidth: 200, fontSize: 15,
                  opacity: (!template.trim() || !sendableGuests.length) ? 0.5 : 1,
                }}
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
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {pct}% הושלם
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleCancel}
                  style={{ color: "#C0392B" }}
                >
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
                        disabled={!g.phone || sendingOneId === g.id || isSending}
                        title={!template.trim() ? "כתוב הודעה תחילה" : `שלח ל${g.name}`}
                        style={{
                          padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700,
                          border: "1px solid #22C55E", background: "#F0FDF4", color: "#15803D",
                          cursor: (!g.phone || isSending) ? "default" : "pointer",
                          opacity: !g.phone ? 0.3 : 1,
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
    </div>
  );
}
