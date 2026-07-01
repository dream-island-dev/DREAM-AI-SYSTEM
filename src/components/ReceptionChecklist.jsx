// src/components/ReceptionChecklist.jsx
// Reception daily digital checklist — verbatim tasks + DB-backed operator audit per shift date.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  RECEPTION_CHECKLIST_SECTIONS,
  RECEPTION_CHECKLIST_TEMPLATE,
  RECEPTION_CHECKLIST_FOOTER,
  receptionChecklistShiftDate,
  buildTemplateKeySet,
  templateRowKey,
  readStoredOperatorName,
  writeStoredOperatorName,
  readSuppressedTemplateKeys,
  addSuppressedTemplateKey,
} from "../utils/receptionChecklistTemplate";

const CREAM = "#F5F0E8";
const CREAM_DARK = "#E8DFD0";
const GOLD = "var(--gold)";
const GOLD_DARK = "var(--gold-dark)";

/** Quick-fill chips for reception staff (optional shortcuts). */
const OPERATOR_QUICK_CHIPS = ["אלונה", "שיראל", "אורן"];

export default function ReceptionChecklist({ user }) {
  const [auditDate, setAuditDate] = useState(() => receptionChecklistShiftDate());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState(null);
  const [openSections, setOpenSections] = useState(() =>
    Object.fromEntries(RECEPTION_CHECKLIST_SECTIONS.map((s) => [s.key, true])),
  );
  const [operatorName, setOperatorName] = useState(() => readStoredOperatorName());
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");

  const liveShiftDate = receptionChecklistShiftDate();
  const isHistoricView = auditDate !== liveShiftDate;

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const ensureSeeded = useCallback(async (date) => {
    if (!supabase) return;

    const templateKeys = buildTemplateKeySet();
    const suppressed = readSuppressedTemplateKeys(date);

    const { data: existing, error: fetchErr } = await supabase
      .from("reception_checklist_entries")
      .select("id, section_key, task_key, task_label")
      .eq("checklist_date", date);
    if (fetchErr) throw fetchErr;

    const orphanIds = (existing ?? [])
      .filter((r) => !templateKeys.has(templateRowKey(r.section_key, r.task_key)))
      .map((r) => r.id);
    if (orphanIds.length > 0) {
      const { error: delErr } = await supabase
        .from("reception_checklist_entries")
        .delete()
        .in("id", orphanIds);
      if (delErr) throw delErr;
    }

    const existingKeys = new Set(
      (existing ?? [])
        .filter((r) => templateKeys.has(templateRowKey(r.section_key, r.task_key)))
        .map((r) => templateRowKey(r.section_key, r.task_key)),
    );

    const missing = RECEPTION_CHECKLIST_TEMPLATE.filter((t) => {
      const k = templateRowKey(t.section, t.key);
      return !existingKeys.has(k) && !suppressed.has(k);
    });
    if (missing.length > 0) {
      const payload = missing.map((t) => ({
        checklist_date: date,
        section_key: t.section,
        task_key: t.key,
        task_label: t.label,
        sort_order: t.sort,
        is_done: false,
      }));
      const { error: insertErr } = await supabase
        .from("reception_checklist_entries")
        .insert(payload);
      if (insertErr) throw insertErr;
    }
  }, []);

  const loadRows = useCallback(
    async (date) => {
      if (!isSupabaseConfigured || !supabase) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        if (date === liveShiftDate) await ensureSeeded(date);
        const { data, error } = await supabase
          .from("reception_checklist_entries")
          .select("*")
          .eq("checklist_date", date)
          .order("sort_order", { ascending: true });
        if (error) throw error;
        setRows(data ?? []);
      } catch (e) {
        showToast("err", "שגיאה בטעינת צ'קליסט: " + (e?.message ?? e));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [ensureSeeded, liveShiftDate],
  );

  useEffect(() => {
    loadRows(auditDate);
  }, [auditDate, loadRows]);

  // 04:00 Israel shift rollover — new date = fresh unchecked template on first seed
  useEffect(() => {
    const tick = () => {
      const next = receptionChecklistShiftDate();
      setAuditDate((prev) => (prev === liveShiftDate && prev !== next ? next : prev));
      if (auditDate === liveShiftDate) loadRows(liveShiftDate);
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [auditDate, liveShiftDate, loadRows]);

  const doneCount = rows.filter((r) => r.is_done).length;
  const pct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;

  const sectionStats = useMemo(() => {
    return RECEPTION_CHECKLIST_SECTIONS.map((section) => {
      const items = rows.filter((r) => r.section_key === section.key);
      const done = items.filter((i) => i.is_done).length;
      const total = items.length;
      return {
        key: section.key,
        label: section.label,
        done,
        total,
        pct: total ? Math.round((done / total) * 100) : 0,
      };
    });
  }, [rows]);

  const rowsBySection = useMemo(() => {
    const map = {};
    for (const s of RECEPTION_CHECKLIST_SECTIONS) map[s.key] = [];
    for (const r of rows) {
      if (map[r.section_key]) map[r.section_key].push(r);
    }
    return map;
  }, [rows]);

  const operatorSignoffs = useMemo(() => {
    const counts = {};
    for (const r of rows) {
      if (!r.is_done || !r.completed_by_name) continue;
      const name = String(r.completed_by_name).trim();
      if (!name) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const recentSignoffs = useMemo(() => {
    return rows
      .filter((r) => r.is_done && r.completed_at)
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
      .slice(0, 8);
  }, [rows]);

  const toggleSection = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleRow = async (row) => {
    if (!supabase || isHistoricView) return;
    const signer = operatorName.trim();
    const rowKey = `${row.section_key}:${row.task_key}`;
    setBusyKey(rowKey);
    const nextDone = !row.is_done;

    if (nextDone && !signer) {
      showToast("err", "רשמו שם עובד בשדה «מי ביצע את המשימה» לפני סימון ✓");
      setBusyKey(null);
      return;
    }

    const patch = nextDone
      ? {
          is_done: true,
          completed_at: new Date().toISOString(),
          completed_by: user?.id ?? null,
          completed_by_name: signer,
        }
      : {
          is_done: false,
          completed_at: null,
          completed_by: null,
          completed_by_name: null,
        };

    const { error } = await supabase
      .from("reception_checklist_entries")
      .update(patch)
      .eq("id", row.id);
    if (error) {
      showToast("err", "שגיאה בשמירה: " + error.message);
    } else {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    }
    setBusyKey(null);
  };

  const startEdit = (row) => {
    if (isHistoricView) return;
    setEditingId(row.id);
    setEditDraft(row.task_label || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async (row) => {
    const label = editDraft.trim();
    if (!label) {
      showToast("err", "טקסט המשימה לא יכול להיות ריק");
      return;
    }
    if (!supabase || isHistoricView) return;
    setBusyKey(`edit:${row.id}`);
    const { error } = await supabase
      .from("reception_checklist_entries")
      .update({ task_label: label })
      .eq("id", row.id);
    if (error) {
      showToast("err", "שגיאה בעדכון: " + error.message);
    } else {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, task_label: label } : r)));
      cancelEdit();
      showToast("ok", "המשימה עודכנה");
    }
    setBusyKey(null);
  };

  const deleteRow = async (row) => {
    if (!supabase || isHistoricView) return;
    if (!window.confirm("למחוק את המשימה מהצ'קליסט של היום?")) return;
    setBusyKey(`del:${row.id}`);
    const { error } = await supabase
      .from("reception_checklist_entries")
      .delete()
      .eq("id", row.id);
    if (error) {
      showToast("err", "שגיאה במחיקה: " + error.message);
    } else {
      addSuppressedTemplateKey(auditDate, row.section_key, row.task_key);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      if (editingId === row.id) cancelEdit();
      showToast("ok", "המשימה נמחקה");
    }
    setBusyKey(null);
  };

  const handleOperatorChange = (value) => {
    setOperatorName(value);
    writeStoredOperatorName(value);
  };

  const formatAuditTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const formatDisplayDate = (ymd) => {
    if (!ymd) return "";
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  };

  return (
    <div style={{ direction: "rtl" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            padding: "12px 24px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
            color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
            border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Elena manager dashboard ── */}
      <div
        style={{
          background: `linear-gradient(135deg, ${CREAM}, #fff)`,
          border: `1px solid ${CREAM_DARK}`,
          borderRadius: 14,
          padding: "18px 20px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Playfair Display, serif",
                fontSize: 22,
                fontWeight: 700,
                color: GOLD_DARK,
              }}
            >
              צ'ק ליסט יומי לתאריך: {formatDisplayDate(auditDate)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              משמרת {isHistoricView ? "ארכיון" : "פעילה"} · איפוס אוטומטי 04:00 (ישראל)
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: GOLD_DARK }}>
              📅 ביקורת משמרות (ילנה)
            </label>
            <input
              type="date"
              value={auditDate}
              max={liveShiftDate}
              onChange={(e) => setAuditDate(e.target.value || liveShiftDate)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${CREAM_DARK}`,
                fontFamily: "Heebo, sans-serif",
                minHeight: 44,
              }}
            />
            {isHistoricView && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAuditDate(liveShiftDate)}
                style={{ minHeight: 44 }}
              >
                ↩ חזרה למשמרת היום
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            סה"כ: {doneCount} / {rows.length} ({pct}%)
          </div>
          <div
            className="progress-bar"
            style={{ height: 12, borderRadius: 8, background: CREAM_DARK }}
          >
            <div
              className="progress-fill"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${GOLD}, ${GOLD_DARK})`,
                borderRadius: 8,
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginTop: 16,
          }}
        >
          {sectionStats.map((s) => (
            <div
              key={s.key}
              style={{
                background: "#fff",
                border: `1px solid ${CREAM_DARK}`,
                borderRadius: 10,
                padding: "10px 12px",
                minHeight: 44,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: GOLD_DARK }}>{s.label}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {s.done}/{s.total} · {s.pct}%
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTop: `1px solid ${CREAM_DARK}`,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: GOLD_DARK, marginBottom: 10 }}>
            👤 מי ביצע את המשימה
          </div>
          {operatorSignoffs.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {operatorSignoffs.map(([name, count]) => (
                <div
                  key={name}
                  style={{
                    minHeight: 44,
                    padding: "8px 14px",
                    borderRadius: 10,
                    background: "#fff",
                    border: `1px solid ${CREAM_DARK}`,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {name}: {count} ✓
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
              עדיין לא סומנו משימות במשמרת זו.
            </div>
          )}
          {recentSignoffs.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "var(--black)", marginBottom: 4 }}>
                יומן אחרון:
              </div>
              {recentSignoffs.map((r) => (
                <div key={r.id}>
                  {formatAuditTime(r.completed_at)} — {r.completed_by_name || "צוות"} ·{" "}
                  {r.task_label.length > 48 ? r.task_label.slice(0, 48) + "…" : r.task_label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div
          style={{
            background: "#FFF5E8",
            border: "1px solid #F5A623",
            borderRadius: 10,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Supabase לא מחובר — לא ניתן לשמור צ'קליסט.
        </div>
      )}

      {isHistoricView && (
        <div
          style={{
            background: "#F0F4FF",
            border: "1px solid #B8C9E8",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🔒 תצוגת ארכיון בלבד — לא ניתן לערוך משימות ממשמרת קודמת.
        </div>
      )}

      {!isHistoricView && (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${CREAM_DARK}`,
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 16,
          }}
        >
          <label
            htmlFor="reception-operator-name"
            style={{ display: "block", fontSize: 14, fontWeight: 800, color: GOLD_DARK, marginBottom: 8 }}
          >
            מי ביצע את המשימה
          </label>
          <input
            id="reception-operator-name"
            type="text"
            value={operatorName}
            onChange={(e) => handleOperatorChange(e.target.value)}
            placeholder="שם העובד/ת (חובה לפני סימון ✓)"
            style={{
              width: "100%",
              maxWidth: 360,
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${operatorName.trim() ? CREAM_DARK : "#E8A0A0"}`,
              fontFamily: "Heebo, sans-serif",
              fontSize: 15,
              minHeight: 44,
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {OPERATOR_QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleOperatorChange(chip)}
                style={{ minHeight: 44 }}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          טוען צ'קליסט...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          אין רשומות לתאריך זה.
        </div>
      ) : (
        RECEPTION_CHECKLIST_SECTIONS.map((section) => {
          const items = rowsBySection[section.key] ?? [];
          const sectionDone = items.filter((i) => i.is_done).length;
          const sectionPct = items.length ? Math.round((sectionDone / items.length) * 100) : 0;
          const isOpen = openSections[section.key];

          return (
            <div
              key={section.key}
              style={{
                marginBottom: 14,
                borderRadius: 12,
                border: `1px solid ${CREAM_DARK}`,
                background: CREAM,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 18px",
                  minHeight: 48,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontFamily: "Heebo, sans-serif",
                  textAlign: "right",
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, color: GOLD_DARK }}>
                  {section.label}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  <span>
                    {sectionDone}/{items.length}
                  </span>
                  <span style={{ width: 64 }}>
                    <div className="progress-bar" style={{ height: 6 }}>
                      <div
                        className="progress-fill"
                        style={{ width: `${sectionPct}%`, background: GOLD }}
                      />
                    </div>
                  </span>
                  <span>{isOpen ? "▲" : "▼"}</span>
                </span>
              </button>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${CREAM_DARK}`, background: "#fff" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 180px)",
                      gap: 8,
                      padding: "10px 18px",
                      background: CREAM,
                      borderBottom: `1px solid ${CREAM_DARK}`,
                      fontSize: 12,
                      fontWeight: 800,
                      color: GOLD_DARK,
                    }}
                  >
                    <span>המטלה</span>
                    <span>הערות</span>
                  </div>

                  {items.map((row) => {
                    const rowKey = `${row.section_key}:${row.task_key}`;
                    const isRowBusy =
                      busyKey === rowKey ||
                      busyKey === `edit:${row.id}` ||
                      busyKey === `del:${row.id}`;
                    const disabled = isHistoricView || isRowBusy;
                    const isEditing = editingId === row.id;

                    return (
                      <div
                        key={row.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 180px)",
                          gap: 8,
                          alignItems: "flex-start",
                          padding: "12px 18px",
                          borderBottom: `1px solid ${CREAM}`,
                          minHeight: 48,
                        }}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <button
                            type="button"
                            disabled={disabled || isEditing}
                            onClick={() => toggleRow(row)}
                            aria-label={row.is_done ? "סומן" : "לא סומן"}
                            title={
                              isHistoricView
                                ? "תצוגת ארכיון בלבד"
                                : !operatorName.trim() && !row.is_done
                                  ? "רשמו שם עובד לפני סימון"
                                  : row.is_done
                                    ? "לחץ לביטול סימון"
                                    : "לחץ לסימון + חתימה"
                            }
                            style={{
                              width: 46,
                              height: 46,
                              minWidth: 46,
                              borderRadius: 10,
                              border: `2px solid ${row.is_done ? GOLD_DARK : CREAM_DARK}`,
                              background: row.is_done ? GOLD : "#fff",
                              cursor: disabled || isEditing ? "not-allowed" : "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 20,
                              color: row.is_done ? "#0F0F0F" : "transparent",
                              flexShrink: 0,
                            }}
                          >
                            ✓
                          </button>
                          <div style={{ flex: 1, paddingTop: 4 }}>
                            {isEditing ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <textarea
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  rows={3}
                                  style={{
                                    width: "100%",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    border: `1px solid ${CREAM_DARK}`,
                                    fontFamily: "Heebo, sans-serif",
                                    fontSize: 14,
                                    lineHeight: 1.45,
                                    resize: "vertical",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={isRowBusy}
                                    onClick={() => saveEdit(row)}
                                    style={{ minHeight: 44 }}
                                  >
                                    שמור
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={cancelEdit}
                                    style={{ minHeight: 44 }}
                                  >
                                    ביטול
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: row.is_done ? 600 : 700,
                                  textDecoration: row.is_done ? "line-through" : "none",
                                  color: row.is_done ? "var(--text-muted)" : "var(--black)",
                                  lineHeight: 1.45,
                                }}
                              >
                                {row.task_label}
                              </div>
                            )}
                            {!isHistoricView && !isEditing && (
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => startEdit(row)}
                                  title="עריכת טקסט המשימה"
                                  style={{ minHeight: 44, padding: "4px 10px" }}
                                >
                                  ✏️ ערוך
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => deleteRow(row)}
                                  title="מחיקת המשימה מהיום"
                                  style={{ minHeight: 44, padding: "4px 10px", color: "#C0392B" }}
                                >
                                  🗑️ מחק
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            paddingTop: 8,
                            minHeight: 44,
                            fontSize: 13,
                            fontWeight: 700,
                            color: row.is_done ? GOLD_DARK : "var(--text-muted)",
                            borderRight: `2px solid ${row.is_done ? GOLD : CREAM_DARK}`,
                            paddingRight: 10,
                          }}
                        >
                          {row.is_done && row.completed_by_name ? (
                            <>
                              <div>{row.completed_by_name} ✓</div>
                              {row.completed_at && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "var(--text-muted)",
                                    marginTop: 2,
                                  }}
                                >
                                  {formatAuditTime(row.completed_at)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ fontWeight: 400, color: "#ccc" }}>—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <div
        style={{
          marginTop: 24,
          padding: "14px 18px",
          background: CREAM,
          border: `1px solid ${CREAM_DARK}`,
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--black)",
          lineHeight: 1.6,
        }}
      >
        {RECEPTION_CHECKLIST_FOOTER}
      </div>
    </div>
  );
}
