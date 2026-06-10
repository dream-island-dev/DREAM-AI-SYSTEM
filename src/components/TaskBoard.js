// src/components/TaskBoard.js
// In-App Task & Ticket Board — Dream Island
//
// Manager view:  create tasks with camera/file image + room + department + priority
// Employee view: see open tasks for their department + mark done
// Storage: Supabase bucket "task_images"

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const HOTEL_DEPARTMENTS = ["תפעול", "משק", "קבלה", "ספא", 'מזמ"ש (F&B)', "הנהלה"];

const PRIORITY_CONFIG = {
  urgent: { label: "🔴 דחוף",  bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
  normal: { label: "🟡 רגיל",  bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
  low:    { label: "🟢 נמוך",  bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
};

// ── Image preview helper ──────────────────────────────────────────────────────
function ImageThumb({ url, alt = "תמונת משימה" }) {
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

// ── Upload image to Supabase Storage ─────────────────────────────────────────
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

// ── New Task Form (manager/admin) ─────────────────────────────────────────────
function NewTaskForm({ user, managerDept, onCreated }) {
  const [form, setForm]         = useState({
    room_number: "", department: managerDept || "", description: "", priority: "normal",
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

      const { data, error: dbErr } = await supabase.from("tasks").insert([{
        room_number: form.room_number.trim() || null,
        department:  form.department,
        description: form.description.trim(),
        priority:    form.priority,
        image_url,
        status:      "open",
        created_by:  user?.id ?? null,
      }]).select().single();

      if (dbErr) throw new Error(dbErr.message);
      onCreated(data);
      setForm({ room_number: "", department: managerDept || "", description: "", priority: "normal" });
      setImgFile(null); setImgPreview(null);
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 24, borderColor: "var(--gold)" }}>
      <div className="card-header">
        <div className="card-title">➕ פתח משימה חדשה</div>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Row 1: Room + Department + Priority */}
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

        {/* Row 2: Description */}
        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>תיאור המשימה *</label>
          <textarea
            rows={3} value={form.description}
            onChange={e => set("description", e.target.value)}
            placeholder="תאר את הבעיה / המשימה בפירוט..."
            style={{ resize: "vertical", direction: "rtl" }}
          />
        </div>

        {/* Row 3: Image upload */}
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

// ── Task Card (employee & manager view) ───────────────────────────────────────
function TaskCard({ task, onMarkDone, isMarkingDone }) {
  const prio = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.normal;
  const isDone = task.status === "done";

  return (
    <div style={{
      borderRadius: 14, border: `1px solid ${isDone ? "#D1FAE5" : prio.border}`,
      background: isDone ? "#F0FDF4" : prio.bg,
      padding: "16px", opacity: isDone ? 0.75 : 1,
      transition: "opacity 0.2s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
            background: isDone ? "#D1FAE5" : prio.bg,
            color: isDone ? "#059669" : prio.color,
            border: `1px solid ${isDone ? "#6EE7B7" : prio.border}`,
          }}>
            {isDone ? "✅ בוצע" : prio.label}
          </span>
          {task.room_number && (
            <span style={{
              marginRight: 8, fontSize: 11, color: "var(--text-muted)",
              background: "var(--ivory)", padding: "2px 8px", borderRadius: 10,
              border: "1px solid var(--border)",
            }}>
              🚪 {task.room_number}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(task.created_at).toLocaleString("he-IL", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })}
        </span>
      </div>

      {/* Image */}
      {task.image_url && (
        <div style={{ marginBottom: 10 }}>
          <ImageThumb url={task.image_url} />
        </div>
      )}

      {/* Description */}
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--black)", marginBottom: 10, lineHeight: 1.5 }}>
        {task.description}
      </div>

      {/* Department + action */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          🏢 {task.department}
        </span>
        {!isDone && (
          <button
            onClick={() => onMarkDone(task.id)}
            disabled={isMarkingDone}
            style={{
              padding: "10px 22px", borderRadius: 10, border: "none",
              background: isMarkingDone
                ? "var(--border)"
                : "linear-gradient(135deg, #16A34A, #15803D)",
              color: "#fff", fontFamily: "Heebo, sans-serif",
              fontSize: 15, fontWeight: 800, cursor: isMarkingDone ? "default" : "pointer",
              boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
              transition: "all 0.15s",
            }}
          >
            {isMarkingDone ? "⏳" : "בוצע ✅"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TaskBoard({ user, isAdmin }) {
  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [markingId,   setMarkingId]   = useState(null);
  const [toast,       setToast]       = useState(null);
  const [activeFilter, setActiveFilter] = useState("open"); // open | done | all
  const managerDept = user?.department || "";

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Determine if user can create tasks
  const canCreate = isAdmin || user?.role === "manager";
  const userDept  = user?.department || "";

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    // Staff sees only their department; managers see all
    if (!canCreate && userDept) {
      query = query.eq("department", userDept);
    }

    const { data, error } = await query;
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setTasks(data ?? []);
    setLoading(false);
  }, [canCreate, userDept, showToast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Mark task as done
  const markDone = useCallback(async (taskId) => {
    setMarkingId(taskId);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "done", resolved_by: user?.id ?? null, resolved_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) showToast("err", "שגיאה: " + error.message);
    else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "done" } : t));
      showToast("ok", "✅ המשימה סומנה כבוצעה!");
    }
    setMarkingId(null);
  }, [user?.id, showToast]);

  // Filtered tasks
  const filtered = tasks.filter(t =>
    activeFilter === "all"  ? true :
    activeFilter === "open" ? t.status === "open" :
                              t.status === "done"
  );

  const openCount = tasks.filter(t => t.status === "open").length;
  const doneCount = tasks.filter(t => t.status === "done").length;

  return (
    <div>
      {/* Toast */}
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

      {/* New task form — managers & admins only */}
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

      {/* Stats + filter tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "open", label: `🔓 פתוחות (${openCount})` },
          { key: "done", label: `✅ בוצעו (${doneCount})` },
          { key: "all",  label: `📋 הכל (${tasks.length})` },
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

      {/* Task list */}
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
              onMarkDone={markDone}
              isMarkingDone={markingId === task.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
