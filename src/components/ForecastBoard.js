// Live occupancy forecast board — reception evening report for Yelena.
import { useCallback, useEffect, useState } from "react";
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

const card = {
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(201,169,110,0.28)",
  borderRadius: 12,
  padding: 14,
};

const th = { textAlign: "right", padding: "6px 8px", color: "var(--gold)", fontWeight: 700, fontSize: 13 };
const td = { padding: "6px 8px", borderTop: "1px solid rgba(201,169,110,0.18)", fontSize: 14 };
const inp = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(0,0,0,0.35)",
  color: "inherit",
  border: "1px solid rgba(201,169,110,0.35)",
  borderRadius: 6,
  padding: "6px 8px",
};

function Cell({ n }) {
  if (n == null || n === "") return <span style={{ opacity: 0.35 }}>—</span>;
  return <strong>{n}</strong>;
}

export default function ForecastBoard() {
  const [targetDate, setTargetDate] = useState(() => addYmd(israelTodayYmd(), 1));
  const [report, setReport] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [phone, setPhone] = useState("");
  const [hour, setHour] = useState(21);
  const [enabled, setEnabled] = useState(true);
  const [groups, setGroups] = useState([]);

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
      const raw = data.config?.groups_by_date?.[targetDate] || data.report?.groups || [];
      setGroups(raw.map(normalizeGroup));
    } catch (e) {
      show(e.message, "err");
    } finally {
      setBusy(false);
    }
  }, [targetDate]);

  useEffect(() => { load(); }, [load]);

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

  function patchGroup(i, field, value) {
    const next = [...groups];
    next[i] = { ...next[i], [field]: value };
    setGroups(next);
  }

  const r = report;
  const groupsTotal = groups.reduce((s, g) => s + (Number(g.qty) || 0), 0);
  const breakfastTotal = r?.meals.breakfast.suites ?? null;
  const lunchTotal = r
    ? (r.meals.lunch.resort || 0) + groupsTotal
    : null;
  const dinnerTotal = r
    ? (r.meals.dinner.suites || 0) + (r.meals.dinner.resort || 0)
    : null;
  const totalWithDepartures = r
    ? r.morningTotal + r.eveningTotal + groupsTotal
      + r.arrivals.guests + r.departures.guests + r.stayovers.guests + r.capsules.guests
    : null;
  const totalOnSite = r && totalWithDepartures != null
    ? totalWithDepartures - r.departures.guests
    : null;

  return (
    <div style={{ padding: 16, maxWidth: 1180, margin: "0 auto", color: "var(--text, #eee)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--gold)" }}>{r ? hebrewDayTitle(r.targetDate) : "📈 דוח צפי"}</h2>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
            כמו דוח הקבלה — סוויטות מפרופילים · ריזורט ממייל תפעול
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>יום יעד
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              style={{ marginRight: 8, marginLeft: 8 }} />
          </label>
          <button type="button" disabled={busy} onClick={syncMail} style={{ background: "var(--gold)", color: "#111", border: 0, borderRadius: 8, padding: "8px 12px", fontWeight: 700 }}>סנכרן מייל EZGO</button>
          <button type="button" disabled={busy} onClick={load} style={{ background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 8, padding: "8px 12px" }}>רענן לוח</button>
        </div>
      </div>

      {toast && (
        <div style={{
          marginBottom: 12, padding: 10, borderRadius: 8,
          background: toast.type === "err" ? "rgba(180,40,40,0.25)" : "rgba(201,169,110,0.18)",
        }}>{toast.msg}</div>
      )}

      {r && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
          <div style={card}>
            <div style={{ fontWeight: 700, color: "var(--gold)", marginBottom: 8 }}>צפי</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={td}>אורחי ריזורט בוקר</td>
                  <td style={{ ...td, textAlign: "left" }}><Cell n={r.morningTotal} /></td>
                  <td style={td} />
                </tr>
                <tr>
                  <td style={td}>אורחי ריזורט ערב</td>
                  <td style={{ ...td, textAlign: "left" }}><Cell n={r.eveningTotal} /></td>
                  <td style={td} />
                </tr>
                <tr>
                  <td style={td}>קבוצות</td>
                  <td style={{ ...td, textAlign: "left" }}><Cell n={groupsTotal} /></td>
                  <td style={td} />
                </tr>
                <tr>
                  <td style={{ ...td, color: "#1a1a1a", fontWeight: 700 }}>סוויטות</td>
                  <td style={{ ...td, color: "var(--gold)" }}>כמות חדרים</td>
                  <td style={{ ...td, color: "var(--gold)" }}>כמות אורחים</td>
                </tr>
                <tr>
                  <td style={td}>הגעות סוויטות</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.arrivals.rooms}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.arrivals.guests}</td>
                </tr>
                <tr>
                  <td style={td}>עזיבות סוויטות</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.departures.rooms}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.departures.guests}</td>
                </tr>
                <tr>
                  <td style={td}>ממשיכי שהייה</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.stayovers.rooms}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.stayovers.guests}</td>
                </tr>
                <tr>
                  <td style={td}>קפסולות</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.capsules.rooms}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.capsules.guests}</td>
                </tr>
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>סהכ אורחים כולל עזיבות</td>
                  <td style={{ ...td, textAlign: "left" }} colSpan={2}><Cell n={totalWithDepartures} /></td>
                </tr>
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>סהכ אורחים במתחם</td>
                  <td style={{ ...td, textAlign: "left" }} colSpan={2}><Cell n={totalOnSite} /></td>
                </tr>
                <tr>
                  <td style={td}>ספא</td>
                  <td style={{ ...td, textAlign: "left" }} colSpan={2}><Cell n={r.spaTreatments} /></td>
                </tr>
              </tbody>
            </table>
            {r.sources.missingOperations && (
              <div style={{ marginTop: 8, color: "#E8C98A" }}>⚠ אין מייל תפעול ליום הזה — לחצי סנכרן מייל.</div>
            )}
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 8px", fontWeight: 700, color: "#1a1a1a" }}>מסעדה</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th} />
                  <th style={th}>א.בוקר</th>
                  <th style={th}>א.צהריים</th>
                  <th style={th}>א.ערב</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>אורחי סוויטות</td>
                  <td style={td}><Cell n={r.meals.breakfast.suites} /></td>
                  <td style={td}><Cell n={null} /></td>
                  <td style={td}><Cell n={r.meals.dinner.suites} /></td>
                </tr>
                <tr>
                  <td style={td}>אורחי ריזורט</td>
                  <td style={td}><Cell n={null} /></td>
                  <td style={td}><Cell n={r.meals.lunch.resort} /></td>
                  <td style={td}><Cell n={r.meals.dinner.resort} /></td>
                </tr>
                <tr>
                  <td style={td}>קבוצות</td>
                  <td style={td}><Cell n={null} /></td>
                  <td style={td}><Cell n={groupsTotal || null} /></td>
                  <td style={td}><Cell n={null} /></td>
                </tr>
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>סהכ</td>
                  <td style={{ ...td, fontWeight: 700 }}><Cell n={breakfastTotal} /></td>
                  <td style={{ ...td, fontWeight: 700 }}><Cell n={lunchTotal} /></td>
                  <td style={{ ...td, fontWeight: 700 }}><Cell n={dinnerTotal} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <h3 style={{ margin: 0, color: "#1a1a1a" }}>קבוצות</h3>
          <span style={{ fontSize: 13, opacity: 0.75 }}>סהכ קבוצות: {groupsTotal}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>שם הקבוצה</th>
                <th style={th}>שעת הגעה</th>
                <th style={th}>כניסה</th>
                <th style={th}>ארוחות</th>
                <th style={th}>כמות צפויה</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i}>
                  <td style={td}><input style={inp} value={g.name} placeholder="שם" onChange={(e) => patchGroup(i, "name", e.target.value)} /></td>
                  <td style={td}><input style={inp} value={g.arrival} placeholder="09:00" onChange={(e) => patchGroup(i, "arrival", e.target.value)} /></td>
                  <td style={td}><input style={inp} value={g.entry} placeholder="קבלה" onChange={(e) => patchGroup(i, "entry", e.target.value)} /></td>
                  <td style={td}><input style={inp} value={g.meals} placeholder="ארוחות / שעה" onChange={(e) => patchGroup(i, "meals", e.target.value)} /></td>
                  <td style={td}><input style={{ ...inp, width: 80 }} type="number" min="0" value={g.qty} onChange={(e) => patchGroup(i, "qty", Number(e.target.value))} /></td>
                  <td style={td}>
                    <button type="button" title="מחק" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setGroups([...groups, { name: "", arrival: "09:00", entry: "קבלה", meals: "", qty: 0 }])}
          style={{ marginTop: 8, background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 8, padding: "6px 12px" }}>
          + קבוצה
        </button>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--gold)" }}>שליחה לילנה · מכשיר סוויטות</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          שליחה אוטומטית כל ערב
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label>שעה ישראל
            <input type="number" min="0" max="23" value={hour} onChange={(e) => setHour(e.target.value)}
              style={{ width: 64, marginRight: 8, marginLeft: 8 }} />
          </label>
          <label>טלפון
            <input value={phone} placeholder="05…" onChange={(e) => setPhone(e.target.value)}
              style={{ marginRight: 8, marginLeft: 8, minWidth: 160 }} />
          </label>
          <button type="button" disabled={busy} onClick={saveSettings} style={{ background: "var(--gold)", color: "#111", border: 0, borderRadius: 8, padding: "8px 12px", fontWeight: 700 }}>שמור הגדרות</button>
          <button type="button" disabled={busy} onClick={sendNow}
            title={!phone.replace(/\D/g, "") ? "חסר טלפון — מלא ושמור" : "שליחה עכשיו"}
            style={{ background: "var(--gold)", color: "#111", border: 0, borderRadius: 8, padding: "8px 12px", fontWeight: 700 }}>
            שלחי עכשיו
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          קישור: https://dream-ai-system.vercel.app/?page=forecast_daily · בלי טלפון אין שליחה אוטומטית (הכפתור נשאר גלוי).
        </div>
      </div>
    </div>
  );
}
