// Live occupancy forecast board — reception evening report for Yelena.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { israelTodayYmd } from "../utils/spaUpsellAudience";

function addYmd(ymd, days) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function hebrewDayTitle(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const names = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${names[dt.getUTCDay()]}- ${dd}/${mm}/${y}`;
}

function normalizeGroup(g) {
  return {
    name: g?.name || "",
    arrival: g?.arrival || "",
    entry: g?.entry || g?.spa || "",
    meals: g?.meals || "",
    qty: Number(g?.qty) || 0,
  };
}

const fieldInput = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1.5px solid var(--border)",
  borderRadius: 8,
  fontFamily: "Heebo, sans-serif",
  fontSize: 14,
  color: "var(--text-main)",
  background: "var(--card-bg)",
};

function Cell({ n, strong }) {
  if (n == null || n === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  return (
    <span style={{
      fontWeight: strong ? 800 : 700,
      color: "var(--black)",
      fontVariantNumeric: "tabular-nums",
    }}>{n}</span>
  );
}

export default function ForecastBoard({ onOpenMailSync }) {
  const [targetDate, setTargetDate] = useState(() => addYmd(israelTodayYmd(), 1));
  const [report, setReport] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [phone, setPhone] = useState("");
  const [hour, setHour] = useState(21);
  const [enabled, setEnabled] = useState(true);
  const [groups, setGroups] = useState([]);
  const [groupPaste, setGroupPaste] = useState("");
  const groupFileRef = useRef(null);

  const show = (msg, type = "ok") => {
    setToast({ msg, type });
    if (type !== "err") setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("forecast-daily", {
        body: { action: "compute", target_date: targetDate },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "טעינה נכשלה");
      setReport(data.report);
      setConfig(data.config);
      setPhone(data.config?.yelena_phone || "");
      setHour(data.config?.send_hour ?? 21);
      setEnabled(data.config?.enabled !== false);
      const raw = (data.report?.groups?.length
        ? data.report.groups
        : data.config?.groups_by_date?.[targetDate]) || [];
      setGroups(raw.map(normalizeGroup));
    } catch (e) {
      show(e.message, "err");
    } finally {
      setBusy(false);
    }
  }, [targetDate]);

  useEffect(() => { load(); }, [load]);

  const autoSyncKey = useRef("");
  useEffect(() => {
    if (!report) return;
    const need = report.sources?.missingOperations || report.sources?.missingDoc2;
    if (!need) return;
    if (autoSyncKey.current === targetDate) return;
    autoSyncKey.current = targetDate;
    syncMail();
  }, [report, targetDate]);

  async function syncMail() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ezgo-mail-sync", {
        body: { manual: true, search_date_ymd: targetDate },
      });
      if (error) throw error;
      if (!data?.ok && !data?.skipped) throw new Error(data?.error || "סנכרון מייל נכשל");
      show("מייל EZGO סונכרן — מרענן צפי");
      await load();
    } catch (e) {
      show(e.message, "err");
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const groups_by_date = { ...(config?.groups_by_date || {}) };
      groups_by_date[targetDate] = groups.map(normalizeGroup);
      const { data, error } = await supabase.functions.invoke("forecast-daily", {
        body: {
          action: "save_config",
          config: {
            enabled,
            send_hour: Number(hour),
            yelena_phone: phone,
            groups_by_date,
          },
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "שמירה נכשלה");
      setConfig(data.config);
      show("נשמר");
      await load();
    } catch (e) {
      show(e.message, "err");
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!phone.replace(/\D/g, "")) {
      show("חסר טלפון של ילנה", "err");
      return;
    }
    setBusy(true);
    try {
      await saveSettings();
      const { data, error } = await supabase.functions.invoke("forecast-daily", {
        body: { action: "send_now", target_date: targetDate, phone },
      });
      if (error) throw error;
      if (!data?.send?.sent) throw new Error(data?.send?.error || data?.error || "שליחה נכשלה");
      show("נשלח לילנה ממכשיר הסוויטות");
    } catch (e) {
      show(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function applyGroupCard({ text, imageBase64, mime }) {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("forecast-daily", {
        body: {
          action: "parse_groups",
          text: text || "",
          image_base64: imageBase64 || "",
          mime: mime || "image/png",
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "קריאת הכרטיס נכשלה");
      const parsed = (data.groups || []).map(normalizeGroup).filter((g) => g.name || g.qty);
      if (!parsed.length) throw new Error("לא זוהו קבוצות בכרטיס — נסי הדבקה או תמונה ברורה יותר");
      setGroups(parsed);
      setGroupPaste("");
      const n = parsed.reduce((s, g) => s + (Number(g.qty) || 0), 0);
      show(`${parsed.length} קבוצות · ${n} אורחים — לחצי שמור הגדרות`);
    } catch (e) {
      show(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function onGroupImage(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      show("התמונה גדולה מדי (מקסימום 4MB)", "err");
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    await applyGroupCard({ imageBase64: b64, mime: file.type || "image/png" });
  }

  function patchGroup(i, field, value) {
    const next = [...groups];
    next[i] = { ...next[i], [field]: value };
    setGroups(next);
  }

  const r = report;
  const groupsTotal = groups.reduce((s, g) => s + (Number(g.qty) || 0), 0);
  const breakfastTotal = r?.meals?.breakfast?.suites ?? null;
  const lunchTotal = r
    ? (r.meals?.lunch?.resort || 0) + groupsTotal
    : null;
  const dinnerTotal = r
    ? (r.meals?.dinner?.suites || 0) + (r.meals?.dinner?.resort || 0)
    : null;
  const totalWithDepartures = r
    ? r.morningTotal + r.eveningTotal + groupsTotal
      + r.arrivals.guests + r.departures.guests + r.stayovers.guests + r.capsules.guests
    : null;
  const totalOnSite = r && totalWithDepartures != null
    ? totalWithDepartures - r.departures.guests
    : null;

  const totalRow = { background: "var(--ivory)", fontWeight: 700 };
  const sectionRow = { background: "var(--ivory)", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: 0.4 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18, alignItems: "flex-end" }}>
        <div>
          <h2 style={{
            margin: 0,
            fontFamily: "'Playfair Display', serif",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--black)",
            letterSpacing: "-0.02em",
          }}>{r ? hebrewDayTitle(r.targetDate) : "📈 דוח צפי"}</h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
            סוויטות מפרופילים · ריזורט+קבוצות ממייל תפעול · כניסות ממייל להשוואה (בלי יצירה אוטומטית)
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="form-field" style={{ marginBottom: 0 }}>
            יום יעד
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={syncMail}>סנכרן מייל EZGO</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={load}>רענן לוח</button>
        </div>
      </div>

      {toast && (
        <div className={toast.type === "err" ? "dashboard-urgent" : "card"} style={{
          marginBottom: 14, padding: 12,
          border: toast.type === "err" ? "1px solid var(--status-danger-bg)" : "1px solid rgba(201,169,110,0.35)",
          background: toast.type === "err" ? "var(--status-danger-bg)" : "rgba(201,169,110,0.12)",
          color: toast.type === "err" ? "var(--status-danger)" : "var(--gold-dark)",
          fontWeight: 700,
        }}>{toast.msg}</div>
      )}

      {r && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="stat-label">סהכ אורחים במתחם</div>
            <div className="stat-value"><Cell n={totalOnSite} strong /></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">כולל עזיבות</div>
            <div className="stat-value"><Cell n={totalWithDepartures} strong /></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">ספא (טיפולים)</div>
            <div className="stat-value"><Cell n={r.spaTreatments} strong /></div>
          </div>
        </div>
      )}

      {r && (
        <div className="dash-grid" style={{ marginBottom: 16 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header"><div className="card-title">צפי</div></div>
            <table className="table">
              <tbody>
                <tr>
                  <td>אורחי ריזורט בוקר</td>
                  <td colSpan={2}><Cell n={r.morningTotal} /></td>
                </tr>
                <tr>
                  <td>אורחי ריזורט ערב</td>
                  <td colSpan={2}><Cell n={r.eveningTotal} /></td>
                </tr>
                <tr>
                  <td>קבוצות</td>
                  <td colSpan={2}><Cell n={groupsTotal} /></td>
                </tr>
                {(r.sources?.ezgoDirectGroup || r.sources?.ezgoSegmentUnmappedIds > 0) && (
                  <tr>
                    <td colSpan={3} style={{
                      color: r.sources.ezgoSegmentUnmappedIds > 0 ? "var(--status-warning)" : "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                      {r.sources.ezgoSegmentUnmappedIds > 0 ? "⚠ " : "✓ "}
                      קבוצות ישירות מאיזיגו (פרופילים): {r.sources.ezgoDirectGroup
                        ? `${r.sources.ezgoDirectGroup.rooms} / ${r.sources.ezgoDirectGroup.guests}`
                        : "0"}
                      {r.sources.ezgoSegmentUnmappedIds > 0
                        ? ` · ${r.sources.ezgoSegmentUnmappedIds} קודים בלי מיפוי (EZGO API)`
                        : ""}
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={sectionRow}>סוויטות</td>
                  <td style={sectionRow}>כמות חדרים</td>
                  <td style={sectionRow}>כמות אורחים</td>
                </tr>
                <tr>
                  <td>הגעות סוויטות</td>
                  <td><Cell n={r.arrivals.rooms} /></td>
                  <td><Cell n={r.arrivals.guests} /></td>
                </tr>
                {r.sources?.doc2Arrivals && (
                  <tr>
                    <td colSpan={3} style={{
                      color: r.sources.suiteArrivalGap ? "var(--status-warning)" : "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                      {r.sources.suiteArrivalGap ? "⚠ " : "✓ "}
                      דוח כניסות במייל: {r.sources.doc2Arrivals.rooms} חדרים / {r.sources.doc2Arrivals.guests} אורחים
                      {r.sources.doc2PendingLines > 0 ? ` · ${r.sources.doc2PendingLines} שורות ממתינות לאישור` : ""}
                    </td>
                  </tr>
                )}
                <tr>
                  <td>עזיבות סוויטות</td>
                  <td><Cell n={r.departures.rooms} /></td>
                  <td><Cell n={r.departures.guests} /></td>
                </tr>
                <tr>
                  <td>ממשיכי שהייה</td>
                  <td><Cell n={r.stayovers.rooms} /></td>
                  <td><Cell n={r.stayovers.guests} /></td>
                </tr>
                <tr>
                  <td>קפסולות</td>
                  <td><Cell n={r.capsules.rooms} /></td>
                  <td><Cell n={r.capsules.guests} /></td>
                </tr>
                <tr style={totalRow}>
                  <td>סהכ אורחים כולל עזיבות</td>
                  <td colSpan={2}><Cell n={totalWithDepartures} strong /></td>
                </tr>
                <tr style={totalRow}>
                  <td>סהכ אורחים במתחם</td>
                  <td colSpan={2}><Cell n={totalOnSite} strong /></td>
                </tr>
                <tr>
                  <td>ספא</td>
                  <td colSpan={2}><Cell n={r.spaTreatments} /></td>
                </tr>
              </tbody>
            </table>
            {r.sources?.missingOperations && (
              <div className="dash-empty-state" style={{ color: "var(--status-warning)" }}>
                ⚠ אין מייל תפעול ליום הזה — הסנכרון רץ אוטומטית. אם נשאר ריק, לחצי סנכרן מייל.
              </div>
            )}
            {r.sources?.missingDoc2 && (
              <div className="dash-empty-state" style={{ color: "var(--status-warning)" }}>
                ⚠ אין דוח כניסות במייל ליום הזה — בלי זה אי אפשר לאמת הגעות סוויטות.
              </div>
            )}
            {r.sources?.suiteArrivalGap && (
              <div className="dash-empty-state" style={{ color: "var(--status-warning)" }}>
                ⚠ פער מול דוח כניסות — אשרי שורות במייל EZGO. XOS לא יוצר אורחים לבד.
                {onOpenMailSync && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => {
                      try { sessionStorage.setItem("xos_data_sync_tab", "ezgo_mail"); } catch { /* ignore */ }
                      onOpenMailSync();
                    }}>פתחי מייל EZGO לאישור</button>
                  </div>
                )}
              </div>
            )}
            {Array.isArray(r.notes) && r.notes.length > 0 && !r.sources?.suiteArrivalGap && (
              <div className="dash-empty-state" style={{ color: "var(--text-muted)" }}>
                {r.notes[0]}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header"><div className="card-title">מסעדה</div></div>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>א.בוקר</th>
                  <th>א.צהריים</th>
                  <th>א.ערב</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>אורחי סוויטות</td>
                  <td><Cell n={r.meals?.breakfast?.suites} /></td>
                  <td><Cell n={null} /></td>
                  <td><Cell n={r.meals?.dinner?.suites} /></td>
                </tr>
                <tr>
                  <td>אורחי ריזורט</td>
                  <td><Cell n={null} /></td>
                  <td><Cell n={r.meals?.lunch?.resort} /></td>
                  <td><Cell n={r.meals?.dinner?.resort} /></td>
                </tr>
                <tr>
                  <td>קבוצות</td>
                  <td><Cell n={null} /></td>
                  <td><Cell n={groupsTotal || null} /></td>
                  <td><Cell n={null} /></td>
                </tr>
                <tr style={totalRow}>
                  <td>סהכ</td>
                  <td><Cell n={breakfastTotal} strong /></td>
                  <td><Cell n={lunchTotal} strong /></td>
                  <td><Cell n={dinnerTotal} strong /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">קבוצות</div>
          <span className="badge badge-gold">סהכ {groupsTotal}</span>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>
            כרטיס «קבלת הקבוצה מהקבלה» — ממלא שמות ושעות. לא יוצר אורחים.
          </div>
          <textarea
            value={groupPaste}
            onChange={(e) => setGroupPaste(e.target.value)}
            placeholder="הדביקי כאן את הכרטיס, או העלי תמונה"
            rows={3}
            style={{ ...fieldInput, minHeight: 72, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy || !groupPaste.trim()}
              onClick={() => applyGroupCard({ text: groupPaste })}>
              קראי כרטיס
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => groupFileRef.current?.click()}>
              העלי תמונה
            </button>
            <input ref={groupFileRef} type="file" accept="image/*" hidden onChange={onGroupImage} />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>שם הקבוצה</th>
                <th>שעת הגעה</th>
                <th>כניסה</th>
                <th>ארוחות</th>
                <th>כמות צפויה</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i}>
                  <td><input style={fieldInput} value={g.name} placeholder="שם" onChange={(e) => patchGroup(i, "name", e.target.value)} /></td>
                  <td><input style={fieldInput} value={g.arrival} placeholder="09:00" onChange={(e) => patchGroup(i, "arrival", e.target.value)} /></td>
                  <td><input style={fieldInput} value={g.entry} placeholder="קבלה" onChange={(e) => patchGroup(i, "entry", e.target.value)} /></td>
                  <td><input style={fieldInput} value={g.meals} placeholder="ארוחות / שעה" onChange={(e) => patchGroup(i, "meals", e.target.value)} /></td>
                  <td><input style={{ ...fieldInput, width: 88 }} type="number" min="0" value={g.qty} onChange={(e) => patchGroup(i, "qty", Number(e.target.value))} /></td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" title="מחק" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={6} className="dash-empty-state">אין קבוצות במייל תפעול ליום הזה — הוסיפי ידנית או סנכרני מייל</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setGroups([...groups, { name: "", arrival: "09:00", entry: "קבלה", meals: "", qty: 0 }])}>
            + קבוצה
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">שליחה לילנה · מכשיר סוויטות</div>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, color: "var(--text-main)", fontWeight: 600 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ accentColor: "var(--gold)" }} />
            שליחה אוטומטית כל ערב
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="form-field" style={{ marginBottom: 0 }}>
              שעה ישראל
              <input type="number" min="0" max="23" value={hour} onChange={(e) => setHour(e.target.value)} style={{ width: 80 }} />
            </label>
            <label className="form-field" style={{ marginBottom: 0 }}>
              טלפון
              <input value={phone} placeholder="05…" onChange={(e) => setPhone(e.target.value)} style={{ minWidth: 160 }} />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveSettings}>שמור הגדרות</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={sendNow}
              title={!phone.replace(/\D/g, "") ? "חסר טלפון — מלא ושמור" : "שליחה עכשיו"}>
              שלחי עכשיו
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
            קישור: https://dream-ai-system.vercel.app/?page=forecast_daily · בלי טלפון אין שליחה אוטומטית (הכפתור נשאר גלוי).
          </div>
        </div>
      </div>
    </div>
  );
}
