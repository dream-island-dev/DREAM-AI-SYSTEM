// src/components/OperationsBoard.js
// Operations & Maintenance Board — merges the old TaskBoard.js (real `tasks`
// table) and the old "Service Calls" screen (real `service_calls` table,
// migrated into `tasks` by migration 071) into one 3-state board.
//
// Sources of incoming work, all landing in the same `tasks` table:
//   • Manual — created here via the "New Task" form (source='manual')
//   • WhatsApp staff report — relay-forwarded group message, parsed by
//     staff-ops-webhook (source='whatsapp_staff')
//   • Legacy — one-time backfill from the retired service_calls screen
//     (source='legacy_service_call')
//
// Claim/done buttons here mirror the "🙋‍♂️ אני מטפל"/"✅ בוצע" WhatsApp
// buttons staff-ops-webhook sends back to the reporter — this in-app path is
// the RELIABLE primary one (WhatsApp delivery is best-effort, see that
// function's header comment for why).

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import ArrivalImportPanel from "./ArrivalImportPanel";
import { getGuestTimingBadge } from "../utils/guestTiming";

const HOTEL_DEPARTMENTS = ["תפעול", "משק", "קבלה", "ספא", 'מזמ"ש (F&B)', "הנהלה"];

const PRIORITY_CONFIG = {
  urgent: { label: "🔴 דחוף",  bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
  normal: { label: "🟡 רגיל",  bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
  low:    { label: "🟢 נמוך",  bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
};

// Same minute thresholds as staff-ops-webhook/index.ts's SLA_THRESHOLDS —
// deliberately duplicated, not imported (frontend can't import a Deno Edge
// Function), same "zero shared code across the front/back boundary"
// convention used throughout this codebase.
const SLA_CATEGORY_OPTIONS = {
  pest_control:    { label: "🐜 הדברה (10 דק')", minutes: 10 },
  guest_amenities: { label: "🛏️ ציוד לאורח (15 דק')", minutes: 15 },
  maintenance:     { label: "🔧 תחזוקה (30 דק')", minutes: 30 },
};

const SOURCE_META = {
  manual:              { label: "🖊 ידני", color: "var(--text-muted)" },
  whatsapp_staff:       { label: "📱 וואטסאפ", color: "#1A7A4A" },
  manual_group:        { label: "✍️ קבוצת צוות", color: "#1A7A4A" },
  legacy_service_call: { label: "🗄 היסטורי", color: "var(--text-muted)" },
  guest_request:       { label: "🛋️ בקשת אורח", color: "#A8843A" },
  portal_room_service: { label: "🍽️ שירות לחדר (פורטל)", color: "#A8843A" },
};

// ── Image preview helper (unchanged from TaskBoard.js) ───────────────────────
function ImageThumb({ url, alt = "תמונה" }) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <img
        src={url} alt={alt}
        onClick={() => setOpen(true)}
        style={{
          width: "100%", maxHeight: 180, objectFit: "cover",
          borderRadius: 10, cursor: "zoom-in", border: "1px solid var(--border)",
        }}
      />
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.85)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <img src={url} alt={alt} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12 }} />
        </div>
      )}
    </>
  );
}

async function uploadTaskImage(file) {
  const ext  = file.name.split(".").pop() || "jpg";
  const path = `tasks/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("task_images").upload(path, file, {
    cacheControl: "3600", upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabase.storage.from("task_images").getPublicUrl(path);
  return publicUrl;
}

// ── New Task Form (manager/admin/receptionist) — now also lets a manual task
// opt into SLA tracking, so it's not a second-class citizen next to
// WhatsApp-reported ones. Exported (Session 30 Sprint 5.4) so
// ReceptionistView.js's streamlined "פתח קריאת שירות" tool can reuse the
// exact same form + DB-write + Whapi-notify path instead of forking a
// second task-creation implementation (CLAUDE.md §0.4 Universal Architecture).
export function NewTaskForm({ user, managerDept, onCreated }) {
  const [form, setForm] = useState({
    room_number: "", department: managerDept || "", description: "", priority: "normal", sla_category: "",
  });
  const [imgFile,  setImgFile]  = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const fileRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleImg = (file) => {
    if (!file) return;
    setImgFile(file);
    const reader = new FileReader();
    reader.onload = e => setImgPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!form.description.trim()) return setError("יש לתאר את המשימה");
    if (!form.department)         return setError("יש לבחור מחלקה");
    setSaving(true); setError("");
    try {
      let image_url = null;
      if (imgFile) image_url = await uploadTaskImage(imgFile);

      const slaMeta = form.sla_category ? SLA_CATEGORY_OPTIONS[form.sla_category] : null;
      const sla_deadline = slaMeta ? new Date(Date.now() + slaMeta.minutes * 60000).toISOString() : null;

      const { data, error: dbErr } = await supabase.from("tasks").insert([{
        room_number: form.room_number.trim() || null,
        department:  form.department,
        description: form.description.trim(),
        priority:    form.priority,
        image_url,
        status:      "open",
        created_by:  user?.id ?? null,
        sla_category: form.sla_category || null,
        sla_deadline,
        source: "manual",
      }]).select().single();

      if (dbErr) throw new Error(dbErr.message);
      onCreated(data);
      setForm({ room_number: "", department: managerDept || "", description: "", priority: "normal", sla_category: "" });
      setImgFile(null); setImgPreview(null);

      // Session 30 Sprint 5.3 — announce the new manual task in the staff
      // Whapi group, same as a WhatsApp-reported one. Fire-and-forget: the
      // ticket already exists on the board regardless of whether the group
      // card succeeds, so a Whapi hiccup must never block the form.
      supabase.functions.invoke("notify-manual-task", { body: { taskId: data.id } })
        .then(({ data: notifyData, error: notifyErr }) => {
          if (notifyErr || notifyData?.ok === false) {
            console.warn("[OperationsBoard] notify-manual-task failed (non-blocking):", notifyErr?.message ?? notifyData?.error);
          }
        });
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 24, borderColor: "var(--gold)" }}>
      <div className="card-header">
        <div className="card-title">➕ פתח משימה חדשה</div>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>מספר/שם חדר</label>
            <input type="text" value={form.room_number}
              onChange={e => set("room_number", e.target.value)}
              placeholder="לדוגמה: 204 / לובי" />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>מחלקה *</label>
            <select value={form.department} onChange={e => set("department", e.target.value)}>
              <option value="">בחר מחלקה...</option>
              {HOTEL_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>עדיפות</label>
            <select value={form.priority} onChange={e => set("priority", e.target.value)}>
              <option value="urgent">🔴 דחוף</option>
              <option value="normal">🟡 רגיל</option>
              <option value="low">🟢 נמוך</option>
            </select>
          </div>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>קטגוריית SLA (אופציונלי — קובע שעון יעד טיפול)</label>
          <select value={form.sla_category} onChange={e => set("sla_category", e.target.value)}>
            <option value="">ללא מעקב SLA</option>
            {Object.entries(SLA_CATEGORY_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>תיאור המשימה *</label>
          <textarea
            rows={3} value={form.description}
            onChange={e => set("description", e.target.value)}
            placeholder="תאר את הבעיה / המשימה בפירוט..."
            style={{ resize: "vertical", direction: "rtl" }}
          />
        </div>

        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, display: "block" }}>
            📷 תמונה (אופציונלי)
          </label>
          {imgPreview ? (
            <div style={{ position: "relative", maxWidth: 300 }}>
              <img src={imgPreview} alt="preview" style={{
                width: "100%", borderRadius: 10, border: "1px solid var(--border)",
                maxHeight: 180, objectFit: "cover",
              }} />
              <button
                onClick={() => { setImgFile(null); setImgPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                style={{
                  position: "absolute", top: 6, left: 6, background: "rgba(220,38,38,0.9)",
                  color: "white", border: "none", borderRadius: "50%",
                  width: 28, height: 28, cursor: "pointer", fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >✕</button>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed var(--border)", borderRadius: 12,
                padding: "24px 16px", textAlign: "center",
                cursor: "pointer", background: "var(--ivory)",
                color: "var(--text-muted)", fontSize: 14,
                transition: "border-color 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
              צלם או בחר תמונה
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={e => handleImg(e.target.files?.[0])}
          />
        </div>

        {error && (
          <div style={{ color: "#DC2626", fontSize: 13, fontWeight: 600 }}>⚠️ {error}</div>
        )}

        <button
          className="btn btn-primary"
          disabled={saving || !form.description.trim() || !form.department}
          onClick={handleSubmit}
          style={{ alignSelf: "flex-end", minWidth: 180 }}
        >
          {saving ? "⏳ שומר..." : "📋 פתח משימה"}
        </button>
      </div>
    </div>
  );
}

// ── Task Card — now 3-state (open/in_progress/done) with SLA badge ──────────
function TaskCard({ task, onClaim, onMarkDone, isUpdating }) {
  const prio = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.normal;
  const isDone = task.status === "done";
  const isInProgress = task.status === "in_progress";
  const src = SOURCE_META[task.source] ?? SOURCE_META.manual;

  const timingBadge = getGuestTimingBadge(task.guests);
  const overdue = task.sla_deadline && !isDone && new Date(task.sla_deadline).getTime() < Date.now();
  const slaMinutesLeft = task.sla_deadline
    ? Math.round((new Date(task.sla_deadline).getTime() - Date.now()) / 60000)
    : null;

  return (
    <div style={{
      borderRadius: 14,
      border: `1px solid ${isDone ? "#D1FAE5" : overdue ? "#DC2626" : prio.border}`,
      background: isDone ? "#F0FDF4" : prio.bg,
      padding: "16px", opacity: isDone ? 0.75 : 1,
      transition: "opacity 0.2s, border-color 0.2s",
      animation: overdue ? "sla-breach-pulse 1.6s ease-in-out infinite" : "none",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
            background: isDone ? "#D1FAE5" : isInProgress ? "#FEF3C7" : prio.bg,
            color: isDone ? "#059669" : isInProgress ? "#B45309" : prio.color,
            border: `1px solid ${isDone ? "#6EE7B7" : isInProgress ? "#FDE68A" : prio.border}`,
          }}>
            {isDone ? "✅ בוצע" : isInProgress ? "🙋‍♂️ בטיפול" : prio.label}
          </span>
          {task.room_number && (
            <span style={{
              fontSize: 11, color: "var(--text-muted)",
              background: "var(--ivory)", padding: "2px 8px", borderRadius: 10,
              border: "1px solid var(--border)",
            }}>
              🚪 {task.room_number}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 600, color: src.color }}>{src.label}</span>
          {timingBadge && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
              background: timingBadge.bg, color: timingBadge.color,
              border: `1px solid ${timingBadge.border}`,
            }}>
              {timingBadge.label}
            </span>
          )}
          {isDone && (task.resolved_by_name || task.resolved_by_phone) && (
            <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>
              ✔️ בוצע ע״י: {task.resolved_by_name || task.resolved_by_phone}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(task.created_at).toLocaleString("he-IL", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })}
        </span>
      </div>

      {/* SLA badge */}
      {task.sla_deadline && !isDone && (
        <div style={{
          fontSize: 11, fontWeight: 700, marginBottom: 8,
          color: overdue ? "#DC2626" : "var(--text-muted)",
        }}>
          {overdue ? `⏰ באיחור ${Math.abs(slaMinutesLeft)} דק' (${task.sla_category ?? ""})` : `⏱ עוד ${slaMinutesLeft} דק' (${task.sla_category ?? ""})`}
        </div>
      )}

      {task.image_url && (
        <div style={{ marginBottom: 10 }}>
          <ImageThumb url={task.image_url} />
        </div>
      )}

      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--black)", marginBottom: 10, lineHeight: 1.5 }}>
        {task.description}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          🏢 {task.department}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {!isDone && !isInProgress && (
            <button
              onClick={() => onClaim(task.id)}
              disabled={isUpdating}
              style={{
                padding: "10px 18px", borderRadius: 10, border: "none",
                background: isUpdating ? "var(--border)" : "linear-gradient(135deg, #D97706, #B45309)",
                color: "#fff", fontFamily: "Heebo, sans-serif",
                fontSize: 14, fontWeight: 800, cursor: isUpdating ? "default" : "pointer",
              }}
            >
              🙋‍♂️ אני מטפל
            </button>
          )}
          {!isDone && (
            <button
              onClick={() => onMarkDone(task.id)}
              disabled={isUpdating}
              style={{
                padding: "10px 18px", borderRadius: 10, border: "none",
                background: isUpdating ? "var(--border)" : "linear-gradient(135deg, #16A34A, #15803D)",
                color: "#fff", fontFamily: "Heebo, sans-serif",
                fontSize: 14, fontWeight: 800, cursor: isUpdating ? "default" : "pointer",
              }}
            >
              {isUpdating ? "⏳" : "בוצע ✅"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OperationsBoard({ user, isAdmin }) {
  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [updatingId,  setUpdatingId]  = useState(null);
  const [toast,       setToast]       = useState(null);
  const [activeFilter, setActiveFilter] = useState("open"); // open | in_progress | done | all
  const managerDept = user?.department || "";

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const canCreate = isAdmin || user?.role === "manager";
  const userDept  = user?.department || "";

  const fetchTasks = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    // guests(...) embed is for the future-arrival/in-house badge (TaskCard) —
    // computed live off arrival_date/departure_date/status, not stored on the
    // task row, so it never goes stale while a request sits open (§0.5).
    let query = supabase
      .from("tasks")
      .select("*, guests(arrival_date, departure_date, status)")
      .order("created_at", { ascending: false });

    if (!canCreate && userDept) {
      query = query.eq("department", userDept);
    }

    const { data, error } = await query;
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setTasks(data ?? []);
    setLoading(false);
  }, [canCreate, userDept, showToast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const claimTask = useCallback(async (taskId) => {
    setUpdatingId(taskId);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "in_progress", claimed_by: user?.id ?? null, claimed_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) showToast("err", "שגיאה: " + error.message);
    else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "in_progress" } : t));
      showToast("ok", "🙋‍♂️ נרשמת כמטפל/ת!");
    }
    setUpdatingId(null);
  }, [user?.id, showToast]);

  const markDone = useCallback(async (taskId) => {
    setUpdatingId(taskId);
    const { error } = await supabase
      .from("tasks")
      // resolved_by_name mirrors the WhatsApp-path attribution (migration 078)
      // so "✔️ בוצע ע״י" renders for in-app-resolved tasks too, not only ones
      // resolved via the 👍🏼 reaction.
      .update({ status: "done", resolved_by: user?.id ?? null, resolved_by_name: user?.name ?? null, resolved_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) showToast("err", "שגיאה: " + error.message);
    else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "done", resolved_by_name: user?.name ?? null } : t));
      showToast("ok", "✅ המשימה סומנה כבוצעה!");
    }
    setUpdatingId(null);
  }, [user?.id, user?.name, showToast]);

  const filtered = tasks.filter(t =>
    activeFilter === "all" ? true : t.status === activeFilter
  );

  const openCount       = tasks.filter(t => t.status === "open").length;
  const inProgressCount = tasks.filter(t => t.status === "in_progress").length;
  const doneCount       = tasks.filter(t => t.status === "done").length;

  return (
    <div>
      <style>{`
        @keyframes sla-breach-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
          50%       { box-shadow: 0 0 0 6px rgba(220,38,38,0.25); }
        }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {canCreate && <ArrivalImportPanel />}

      {canCreate && (
        <NewTaskForm
          user={user}
          managerDept={managerDept}
          onCreated={(task) => {
            setTasks(prev => [task, ...prev]);
            showToast("ok", "✅ משימה נפתחה בהצלחה!");
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "open",        label: `🔓 פתוחות (${openCount})` },
          { key: "in_progress", label: `🙋‍♂️ בטיפול (${inProgressCount})` },
          { key: "done",        label: `✅ בוצעו (${doneCount})` },
          { key: "all",         label: `📋 הכל (${tasks.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveFilter(key)}
            style={{
              padding: "7px 16px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              border: `2px solid ${activeFilter === key ? "var(--gold)" : "var(--border)"}`,
              background: activeFilter === key ? "rgba(201,169,110,0.12)" : "var(--card-bg)",
              color: activeFilter === key ? "var(--gold-dark)" : "var(--text-muted)",
            }}
          >{label}</button>
        ))}
        <button onClick={fetchTasks} disabled={loading}
          style={{ padding: "7px 14px", borderRadius: 20, border: "1px solid var(--border)",
            background: "var(--card-bg)", cursor: "pointer", fontSize: 13, color: "var(--text-muted)" }}>
          {loading ? "⏳" : "🔄"}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 56, color: "var(--text-muted)", fontSize: 14 }}>
          ⏳ טוען משימות...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          border: "1px dashed var(--border)", borderRadius: 14,
          color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
          {activeFilter === "open" ? "אין משימות פתוחות כרגע 🎉" : "אין משימות להצגה"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onClaim={claimTask}
              onMarkDone={markDone}
              isUpdating={updatingId === task.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
