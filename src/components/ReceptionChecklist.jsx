// src/components/ReceptionChecklist.jsx
// Reception daily digital checklist — DB-backed audit log per shift date.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  RECEPTION_CHECKLIST_SECTIONS,
  RECEPTION_CHECKLIST_TEMPLATE,
  receptionChecklistShiftDate,
} from "../utils/receptionChecklistTemplate";

const CREAM = "#F5F0E8";
const CREAM_DARK = "#E8DFD0";
const GOLD = "var(--gold)";
const GOLD_DARK = "var(--gold-dark)";

const RECEPTION_OPERATORS = ["סיוון", "שיראל", "אלונה"];

export default function ReceptionChecklist({ user }) {
  const [auditDate, setAuditDate] = useState(() => receptionChecklistShiftDate());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState(null);
  const [openSections, setOpenSections] = useState(() =>
    Object.fromEntries(RECEPTION_CHECKLIST_SECTIONS.map((s) => [s.key, true])),
  );

  const liveShiftDate = receptionChecklistShiftDate();
  const isHistoricView = auditDate !== liveShiftDate;
  const operatorName = user?.name || user?.email || "צוות";

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const ensureSeeded = useCallback(async (date) => {
    if (!supabase) return;
    const { count, error: countErr } = await supabase
      .from("reception_checklist_entries")
      .select("id", { count: "exact", head: true })
      .eq("checklist_date", date);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) return;

    const payload = RECEPTION_CHECKLIST_TEMPLATE.map((t) => ({
      checklist_date: date,
      section_key: t.section,
      task_key: t.key,
      task_label: t.label,
      sort_order: t.sort,
      is_done: false,
    }));
    const { error } = await supabase.from("reception_checklist_entries").insert(payload);
    if (error) throw error;
  }, []);

  const loadRows = useCallback(async (date) => {
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
  }, [ensureSeeded, liveShiftDate]);

  useEffect(() => {
    loadRows(auditDate);
  }, [auditDate, loadRows]);

  // 04:00 shift rollover — refresh when Israel hour crosses into new shift day
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

  const rowsBySection = useMemo(() => {
    const map = {};
    for (const s of RECEPTION_CHECKLIST_SECTIONS) map[s.key] = [];
    for (const r of rows) {
      if (map[r.section_key]) map[r.section_key].push(r);
    }
    return map;
  }, [rows]);

  const operatorSignoffs = useMemo(() => {
    const counts = Object.fromEntries(RECEPTION_OPERATORS.map((n) => [n, 0]));
    let other = 0;
    for (const r of rows) {
      if (!r.is_done || !r.completed_by_name) continue;
      const name = String(r.completed_by_name).trim();
      const known = RECEPTION_OPERATORS.find((op) => name.includes(op));
      if (known) counts[known] += 1;
      else other += 1;
    }
    return { counts, other };
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
    const rowKey = `${row.section_key}:${row.task_key}`;
    setBusyKey(rowKey);
    const nextDone = !row.is_done;
    const patch = nextDone
      ? {
          is_done: true,
          completed_at: new Date().toISOString(),
          completed_by: user?.id ?? null,
          completed_by_name: operatorName,
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

  return (
    <div style={{ direction: "rtl" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{
        background: `linear-gradient(135deg, ${CREAM}, #fff)`,
        border: `1px solid ${CREAM_DARK}`,
        borderRadius: 14,
        padding: "18px 20px",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "Playfair Display, serif", fontSize: 22, fontWeight: 700, color: GOLD_DARK }}>
              📋 צ'קליסט קבלה יומי
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              משמרת: {auditDate}
              {isHistoricView ? " (ארכיון)" : " (היום)"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: GOLD_DARK }}>
              📅 ביקורת היסטורית
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
            {doneCount} / {rows.length} הושלמו ({pct}%)
          </div>
          <div className="progress-bar" style={{ height: 12, borderRadius: 8, background: CREAM_DARK }}>
            <div
              className="progress-fill"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${GOLD}, ${GOLD_DARK})`, borderRadius: 8 }}
            />
          </div>
        </div>

        <div style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: `1px solid ${CREAM_DARK}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: GOLD_DARK, marginBottom: 10 }}>
            👤 מעקב חתימות צוות (אלנה / מנהל)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {RECEPTION_OPERATORS.map((name) => (
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
                {name}: {operatorSignoffs.counts[name]} ✓
              </div>
            ))}
            {operatorSignoffs.other > 0 && (
              <div style={{
                minHeight: 44, padding: "8px 14px", borderRadius: 10,
                background: "#fff", border: `1px solid ${CREAM_DARK}`,
                fontSize: 13, color: "var(--text-muted)",
              }}>
                אחר: {operatorSignoffs.other} ✓
              </div>
            )}
          </div>
          {recentSignoffs.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "var(--black)", marginBottom: 4 }}>יומן אחרון:</div>
              {recentSignoffs.map((r) => (
                <div key={r.id}>
                  {formatAuditTime(r.completed_at)} — {r.completed_by_name || "צוות"} · {r.task_label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 }}>
          Supabase לא מחובר — לא ניתן לשמור צ'קליסט.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען צ'קליסט...</div>
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
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
                  <span>{sectionDone}/{items.length}</span>
                  <span style={{ width: 64 }}>
                    <div className="progress-bar" style={{ height: 6 }}>
                      <div className="progress-fill" style={{ width: `${sectionPct}%`, background: GOLD }} />
                    </div>
                  </span>
                  <span>{isOpen ? "▲" : "▼"}</span>
                </span>
              </button>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${CREAM_DARK}`, background: "#fff" }}>
                  {items.map((row) => {
                    const rowKey = `${row.section_key}:${row.task_key}`;
                    const disabled = isHistoricView || busyKey === rowKey;
                    return (
                      <div
                        key={row.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "12px 18px",
                          borderBottom: `1px solid ${CREAM}`,
                          minHeight: 48,
                        }}
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleRow(row)}
                          aria-label={row.is_done ? "סומן" : "לא סומן"}
                          title={isHistoricView ? "תצוגת ארכיון בלבד" : row.task_label}
                          style={{
                            width: 46,
                            height: 46,
                            minWidth: 46,
                            borderRadius: 10,
                            border: `2px solid ${row.is_done ? GOLD_DARK : CREAM_DARK}`,
                            background: row.is_done ? GOLD : "#fff",
                            cursor: disabled ? "not-allowed" : "pointer",
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
                          <div style={{
                            fontSize: 15,
                            fontWeight: row.is_done ? 600 : 700,
                            textDecoration: row.is_done ? "line-through" : "none",
                            color: row.is_done ? "var(--text-muted)" : "var(--black)",
                          }}>
                            {row.task_label}
                          </div>
                          {row.is_done && row.completed_by_name && (
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                              ✓ {row.completed_by_name}
                              {row.completed_at ? ` · ${formatAuditTime(row.completed_at)}` : ""}
                            </div>
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
    </div>
  );
}
