import { useMemo, useState } from "react";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import { israelHmFromIso, resolveQueueScheduleDateYmd } from "../utils/israelTime";

const MODE_LABELS = {
  by_day: "לפי יום הגעה",
  by_stage: "לפי שלב",
  per_item: "שעה לכל הודעה",
};

function itemKey(item) {
  return `${item.guestId}_${item.stageKey}`;
}

function dayKey(item) {
  return item.arrivalDate || "__none__";
}

/**
 * Bulk schedule modal for ACC Live Queue — writes staff_schedule_tasks_batch RPC.
 */
export default function QueueBulkScheduleModal({
  items,
  dayLabels = {},
  onClose,
  onConfirm,
  saving,
  error,
}) {
  const [mode, setMode] = useState("by_day");
  const [timesByDay, setTimesByDay] = useState({});
  const [timesByStage, setTimesByStage] = useState({});
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
      init[itemKey(q)] = resolveQueueScheduleDateYmd(q);
    }
    return init;
  });

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
    if (mode === "by_day") {
      return items
        .filter((q) => timesByDay[dayKey(q)])
        .map((q) => ({
          guestName: q.guestName,
          stage: q.displayName ?? q.stageKey,
          when: `${dayLabels[dayKey(q)] ?? dayKey(q)} · ${timesByDay[dayKey(q)]}`,
        }));
    }
    if (mode === "by_stage") {
      return items
        .filter((q) => timesByStage[q.stageKey])
        .map((q) => ({
          guestName: q.guestName,
          stage: q.displayName ?? q.stageKey,
          when: `${resolveQueueScheduleDateYmd(q)} · ${timesByStage[q.stageKey]}`,
        }));
    }
    return items
      .filter((q) => timesByItem[itemKey(q)] && datesByItem[itemKey(q)])
      .map((q) => ({
        guestName: q.guestName,
        stage: q.displayName ?? q.stageKey,
        when: `${datesByItem[itemKey(q)]} · ${timesByItem[itemKey(q)]}`,
      }));
  }, [mode, items, timesByDay, timesByStage, timesByItem, datesByItem, dayLabels]);

  const buildPayload = () => {
    if (mode === "by_day") {
      return items
        .filter((q) => timesByDay[dayKey(q)])
        .map((q) => ({
          guest_id: q.guestId,
          stage_key: q.stageKey,
          schedule_date: resolveQueueScheduleDateYmd(q),
          schedule_time: timesByDay[dayKey(q)],
        }));
    }
    if (mode === "by_stage") {
      return items
        .filter((q) => timesByStage[q.stageKey])
        .map((q) => ({
          guest_id: q.guestId,
          stage_key: q.stageKey,
          schedule_date: resolveQueueScheduleDateYmd(q),
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
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
          {items.length} הודעות נבחרו. השעות נשמרות ב-<code>scheduled_tasks</code> — ה-cron ישלח אוטומטית
          בזמן שנקבע (פעימה של 2.5ש׳ בין הודעות). אפשר גם «שלח עכשיו» לפני המועד.
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {Object.entries(MODE_LABELS).map(([key, label]) => (
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
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.count} הודעות</div>
                </div>
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
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.count} אורחים · תאריך לפי מועד משוער</div>
                </div>
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
          <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
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

        {previewRows.length > 0 && (
          <div style={{
            marginTop: 16, padding: "10px 12px", borderRadius: 10,
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
            disabled={saving || payloadCount === 0}
            title={payloadCount === 0 ? "הגדר לפחות שעה אחת" : ""}
            onClick={() => onConfirm(buildPayload())}
            style={{ minWidth: 160 }}
          >
            {saving ? "⏳ שומר..." : `📅 שמור תזמון (${payloadCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
