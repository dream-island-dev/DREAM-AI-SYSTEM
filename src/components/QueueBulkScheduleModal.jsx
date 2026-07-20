import { useMemo, useState } from "react";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import {
  formatIsraelDateTime,
  futureScheduleDateYmd,
  israelTodayYmd,
  israelTomorrowYmd,
  israelHmFromIso,
} from "../utils/israelTime";

const MODE_LABELS = {
  together: "שעה אחת לכולם",
  by_stage: "לפי שלב",
  by_day: "לפי יום הגעה",
  per_item: "לכל הודעה בנפרד",
};

const QUICK_PRESETS = [
  { id: "tomorrow_08", label: "🌅 מחר 08:00", date: () => israelTomorrowYmd(), time: "08:00" },
  { id: "tomorrow_10", label: "☀️ מחר 10:00", date: () => israelTomorrowYmd(), time: "10:00" },
  { id: "tomorrow_12", label: "🌤️ מחר 12:00", date: () => israelTomorrowYmd(), time: "12:00" },
  { id: "today_18", label: "🌆 היום 18:00", date: () => israelTodayYmd(), time: "18:00" },
];

function itemKey(item) {
  return `${item.guestId}_${item.stageKey}`;
}

function dayKey(item) {
  return item.arrivalDate || "__none__";
}

function scheduleIsoFromParts(dateYmd, timeHm) {
  if (!dateYmd || !timeHm) return null;
  const d = new Date(`${dateYmd}T${timeHm}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Bulk schedule modal for ACC Live Queue — writes staff_schedule_tasks_batch RPC.
 */
export default function QueueBulkScheduleModal({
  items,
  dayLabels = {},
  initialDate,
  initialTime,
  onClose,
  onConfirm,
  saving,
  error,
}) {
  const [mode, setMode] = useState("together");
  const [activePreset, setActivePreset] = useState(null);
  const [globalDate, setGlobalDate] = useState(
    () => initialDate || israelTomorrowYmd(),
  );
  const [globalTime, setGlobalTime] = useState(() => initialTime || "08:00");
  const [timesByDay, setTimesByDay] = useState({});
  const [datesByDay, setDatesByDay] = useState(() => {
    const init = {};
    for (const q of items) {
      const dk = dayKey(q);
      if (!init[dk]) init[dk] = futureScheduleDateYmd(q);
    }
    return init;
  });
  const [timesByStage, setTimesByStage] = useState({});
  const [datesByStage, setDatesByStage] = useState(() => {
    const byStage = new Map();
    for (const q of items) {
      if (!byStage.has(q.stageKey)) byStage.set(q.stageKey, []);
      byStage.get(q.stageKey).push(q);
    }
    const init = {};
    for (const [sk, qs] of byStage.entries()) {
      init[sk] = qs.reduce(
        (best, item) => {
          const d = futureScheduleDateYmd(item);
          return !best || d < best ? d : best;
        },
        null,
      ) ?? israelTomorrowYmd();
    }
    return init;
  });
  const [timesByItem, setTimesByItem] = useState(() => {
    const init = {};
    for (const q of items) {
      init[itemKey(q)] = israelHmFromIso(q.scheduledFor) || "10:00";
    }
    return init;
  });
  const [datesByItem, setDatesByItem] = useState(() => {
    const init = {};
    for (const q of items) {
      init[itemKey(q)] = futureScheduleDateYmd(q);
    }
    return init;
  });

  const applyPreset = (preset) => {
    const date = preset.date();
    const time = preset.time;
    setActivePreset(preset.id);
    setGlobalDate(date);
    setGlobalTime(time);
    setMode("together");
    setTimesByDay((prev) => {
      const next = { ...prev };
      for (const q of items) next[dayKey(q)] = time;
      return next;
    });
    setDatesByDay((prev) => {
      const next = { ...prev };
      for (const q of items) next[dayKey(q)] = date;
      return next;
    });
    setTimesByStage((prev) => {
      const next = { ...prev };
      for (const q of items) next[q.stageKey] = time;
      return next;
    });
    setDatesByStage((prev) => {
      const next = { ...prev };
      for (const q of items) next[q.stageKey] = date;
      return next;
    });
    setTimesByItem((prev) => {
      const next = { ...prev };
      for (const q of items) next[itemKey(q)] = time;
      return next;
    });
    setDatesByItem((prev) => {
      const next = { ...prev };
      for (const q of items) next[itemKey(q)] = date;
      return next;
    });
  };

  const uniqueDays = useMemo(() => {
    const map = new Map();
    for (const q of items) {
      const dk = dayKey(q);
      if (!map.has(dk)) {
        map.set(dk, {
          dateKey: dk,
          label: dayLabels[dk] ?? (dk === "__none__" ? "ללא תאריך הגעה" : dk),
          count: 0,
        });
      }
      map.get(dk).count += 1;
    }
    return [...map.values()];
  }, [items, dayLabels]);

  const uniqueStages = useMemo(() => {
    const map = new Map();
    for (const q of items) {
      if (!map.has(q.stageKey)) {
        map.set(q.stageKey, { stageKey: q.stageKey, displayName: q.displayName ?? q.stageKey, count: 0 });
      }
      map.get(q.stageKey).count += 1;
    }
    return [...map.values()];
  }, [items]);

  const previewRows = useMemo(() => {
    if (mode === "together") {
      if (!globalDate || !globalTime) return [];
      const when = `${globalDate} · ${globalTime}`;
      return items.map((q) => ({
        guestName: q.guestName,
        stage: q.displayName ?? q.stageKey,
        when,
      }));
    }
    if (mode === "by_day") {
      return items
        .filter((q) => timesByDay[dayKey(q)] && datesByDay[dayKey(q)])
        .map((q) => ({
          guestName: q.guestName,
          stage: q.displayName ?? q.stageKey,
          when: `${datesByDay[dayKey(q)]} · ${timesByDay[dayKey(q)]}`,
        }));
    }
    if (mode === "by_stage") {
      return items
        .filter((q) => timesByStage[q.stageKey] && datesByStage[q.stageKey])
        .map((q) => ({
          guestName: q.guestName,
          stage: q.displayName ?? q.stageKey,
          when: `${datesByStage[q.stageKey]} · ${timesByStage[q.stageKey]}`,
        }));
    }
    return items
      .filter((q) => timesByItem[itemKey(q)] && datesByItem[itemKey(q)])
      .map((q) => ({
        guestName: q.guestName,
        stage: q.displayName ?? q.stageKey,
        when: `${datesByItem[itemKey(q)]} · ${timesByItem[itemKey(q)]}`,
      }));
  }, [mode, items, globalDate, globalTime, timesByDay, timesByStage, timesByItem, datesByItem, datesByDay, datesByStage]);

  const buildPayload = () => {
    if (mode === "together") {
      if (!globalDate || !globalTime) return [];
      return items.map((q) => ({
        guest_id: q.guestId,
        stage_key: q.stageKey,
        schedule_date: globalDate,
        schedule_time: globalTime,
      }));
    }
    if (mode === "by_day") {
      return items
        .filter((q) => timesByDay[dayKey(q)] && datesByDay[dayKey(q)])
        .map((q) => ({
          guest_id: q.guestId,
          stage_key: q.stageKey,
          schedule_date: datesByDay[dayKey(q)],
          schedule_time: timesByDay[dayKey(q)],
        }));
    }
    if (mode === "by_stage") {
      return items
        .filter((q) => timesByStage[q.stageKey] && datesByStage[q.stageKey])
        .map((q) => ({
          guest_id: q.guestId,
          stage_key: q.stageKey,
          schedule_date: datesByStage[q.stageKey],
          schedule_time: timesByStage[q.stageKey],
        }));
    }
    return items
      .filter((q) => timesByItem[itemKey(q)] && datesByItem[itemKey(q)])
      .map((q) => ({
        guest_id: q.guestId,
        stage_key: q.stageKey,
        schedule_date: datesByItem[itemKey(q)],
        schedule_time: timesByItem[itemKey(q)],
      }));
  };

  const payloadCount = buildPayload().length;
  const scheduleIsoPreview = useMemo(
    () => (mode === "together" ? scheduleIsoFromParts(globalDate, globalTime) : null),
    [mode, globalDate, globalTime],
  );
  const scheduleInPast = scheduleIsoPreview
    ? new Date(scheduleIsoPreview).getTime() <= Date.now()
    : false;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 10002,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "24px 28px",
        maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto",
        direction: "rtl", boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>📅 תזמון שליחה</div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 14px" }}>
          {items.length} הודעות נבחרו — בחרו מועד מהיר או הגדירו תאריך ושעה. מתאים להודעות שפספסו חלון (למשל אישור הגעה אחרי ייבוא מאוחר).
        </p>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text-muted)" }}>
            קיצורי דרך
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={saving}
                style={{
                  padding: "8px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                  border: activePreset === preset.id ? "2px solid var(--gold-dark)" : "1px solid var(--border)",
                  background: activePreset === preset.id ? "rgba(201,169,110,0.22)" : "#fff",
                  fontWeight: activePreset === preset.id ? 700 : 500,
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "14px 16px", borderRadius: 12,
          border: mode === "together" ? "2px solid var(--gold)" : "1px solid var(--border)",
          background: mode === "together" ? "rgba(201,169,110,0.08)" : "var(--ivory)",
          marginBottom: 16,
          opacity: mode === "together" ? 1 : 0.65,
        }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>שעה אחת לכל {items.length} ההודעות</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {mode === "together" ? "ברירת מחדל: מחר בבוקר" : "לא פעיל — נבחר מצב מתקדם למטה"}
            </div>
          </div>
          <input
            type="date"
            value={globalDate}
            onChange={(e) => {
              setMode("together");
              setActivePreset(null);
              setGlobalDate(e.target.value);
            }}
            disabled={saving || mode !== "together"}
            min={israelTodayYmd()}
            title="תאריך שליחה"
            style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <div style={{ width: 130 }}>
            <IsraeliTimeSelect
              value={globalTime}
              onChange={(v) => {
                setMode("together");
                setActivePreset(null);
                setGlobalTime(v);
              }}
              disabled={saving || mode !== "together"}
              startHour={6}
              endHour={23}
            />
          </div>
        </div>

        {scheduleIsoPreview && (
          <div style={{
            fontSize: 12, marginBottom: 14, padding: "8px 12px", borderRadius: 8,
            background: scheduleInPast ? "#FFF0EE" : "rgba(26,122,74,0.08)",
            color: scheduleInPast ? "#C0392B" : "#1A7A4A",
            border: `1px solid ${scheduleInPast ? "#C0392B" : "#1A7A4A"}`,
          }}>
            {scheduleInPast
              ? "⚠ השעה כבר עברה — בחרו מועד עתידי"
              : `✓ יישלח בערך ${formatIsraelDateTime(scheduleIsoPreview)}`}
          </div>
        )}

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
            אפשרויות מתקדמות (לפי שלב / יום / הודעה)
          </summary>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {Object.entries(MODE_LABELS)
                .filter(([key]) => key !== "together")
                .map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    disabled={saving}
                    style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: mode === key ? "1px solid var(--gold-dark)" : "1px solid var(--border)",
                      background: mode === key ? "rgba(201,169,110,0.18)" : "#fff",
                      fontWeight: mode === key ? 700 : 500,
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>

            {mode === "by_day" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {uniqueDays.map((d) => (
                  <div key={d.dateKey} style={{
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)",
                    background: "var(--ivory)",
                  }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{d.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.count} הודעות · הגעה</div>
                    </div>
                    <input
                      type="date"
                      value={datesByDay[d.dateKey] ?? ""}
                      onChange={(e) => setDatesByDay((prev) => ({ ...prev, [d.dateKey]: e.target.value }))}
                      disabled={saving}
                      min={israelTodayYmd()}
                      title="תאריך שליחה"
                      style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                    <div style={{ width: 130 }}>
                      <IsraeliTimeSelect
                        value={timesByDay[d.dateKey] ?? ""}
                        onChange={(v) => setTimesByDay((prev) => ({ ...prev, [d.dateKey]: v }))}
                        disabled={saving}
                        emptyLabel="— שעה —"
                        startHour={6}
                        endHour={23}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode === "by_stage" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {uniqueStages.map((s) => (
                  <div key={s.stageKey} style={{
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)",
                  }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.displayName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.count} אורחים · תאריך + שעת שליחה</div>
                    </div>
                    <input
                      type="date"
                      value={datesByStage[s.stageKey] ?? ""}
                      onChange={(e) => setDatesByStage((prev) => ({ ...prev, [s.stageKey]: e.target.value }))}
                      disabled={saving}
                      min={israelTodayYmd()}
                      title="תאריך שליחה"
                      style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                    <div style={{ width: 130 }}>
                      <IsraeliTimeSelect
                        value={timesByStage[s.stageKey] ?? ""}
                        onChange={(v) => setTimesByStage((prev) => ({ ...prev, [s.stageKey]: v }))}
                        disabled={saving}
                        emptyLabel="— שעה —"
                        startHour={6}
                        endHour={23}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode === "per_item" && (
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
                <table className="table" style={{ margin: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>אורח</th>
                      <th>שלב</th>
                      <th>תאריך</th>
                      <th>שעה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((q) => {
                      const ik = itemKey(q);
                      return (
                        <tr key={ik}>
                          <td style={{ fontWeight: 600 }}>{q.guestName ?? "—"}</td>
                          <td>{q.displayName ?? q.stageKey}</td>
                          <td>
                            <input
                              type="date"
                              value={datesByItem[ik] ?? ""}
                              onChange={(e) => setDatesByItem((prev) => ({ ...prev, [ik]: e.target.value }))}
                              disabled={saving}
                              min={israelTodayYmd()}
                              style={{ padding: "4px 6px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                            />
                          </td>
                          <td style={{ width: 120 }}>
                            <IsraeliTimeSelect
                              value={timesByItem[ik] ?? ""}
                              onChange={(v) => setTimesByItem((prev) => ({ ...prev, [ik]: v }))}
                              disabled={saving}
                              startHour={6}
                              endHour={23}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>

        {previewRows.length > 0 && (
          <div style={{
            marginTop: 4, padding: "10px 12px", borderRadius: 10,
            background: "rgba(201,169,110,0.08)", border: "1px solid var(--gold)",
            fontSize: 12, maxHeight: 120, overflowY: "auto",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>תצוגה מקדימה ({previewRows.length})</div>
            {previewRows.slice(0, 8).map((r, i) => (
              <div key={i} style={{ color: "var(--text-muted)", marginBottom: 2 }}>
                {r.guestName} — {r.stage}: <strong style={{ color: "var(--black)" }}>{r.when}</strong>
              </div>
            ))}
            {previewRows.length > 8 && (
              <div style={{ color: "var(--text-muted)" }}>… ועוד {previewRows.length - 8}</div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 8,
            background: "#FFF0EE", border: "1px solid #C0392B", color: "#C0392B", fontSize: 13,
          }}>
            ❌ {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || payloadCount === 0 || (mode === "together" && scheduleInPast)}
            title={payloadCount === 0 ? "הגדר לפחות תאריך ושעה" : scheduleInPast ? "בחרו מועד עתידי" : ""}
            onClick={() => onConfirm(buildPayload())}
            style={{ minWidth: 180, background: "var(--gold-dark)", borderColor: "var(--gold-dark)" }}
          >
            {saving ? "⏳ שומר..." : `📅 שמור תזמון (${payloadCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
