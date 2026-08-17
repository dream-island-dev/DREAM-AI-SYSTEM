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

const card = {
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(201,169,110,0.28)",
  borderRadius: 12,
  padding: 14,
};

function Num({ n, empty }) {
  if (n == null || n === "") {
    return <span style={{ color: "#C9A96E" }}>{empty || "לא נמצא"}</span>;
  }
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
      setGroups(data.config?.groups_by_date?.[targetDate] || data.report?.groups || []);
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
      groups_by_date[targetDate] = groups;
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

  const r = report;
  const mealSum = (slot) => {
    if (!r) return null;
    const m = r.meals[slot];
    const parts = [m.suites, m.resort, m.groups].filter((x) => x != null);
    if (!parts.length) return null;
    return parts.reduce((s, n) => s + n, 0);
  };

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto", color: "var(--text, #eee)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--gold)" }}>📈 דוח צפי חי</h2>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
            סוויטות מפרופילי אורחים (API) · ריזורט ממייל Operations · קישור לילנה בערב
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10, marginBottom: 14 }}>
          <div style={card}><div>ריזורט בוקר</div><div style={{ fontSize: 28 }}><Num n={r.morningTotal} /></div></div>
          <div style={card}><div>ריזורט ערב</div><div style={{ fontSize: 28 }}><Num n={r.eveningTotal} /></div></div>
          <div style={card}><div>קבוצות</div><div style={{ fontSize: 28 }}><Num n={r.groupsTotal} /></div></div>
          <div style={card}><div>סה״כ במתחם</div><div style={{ fontSize: 28 }}><Num n={r.totalOnSite} /></div></div>
          <div style={card}><div>כולל עזיבות</div><div style={{ fontSize: 28 }}><Num n={r.totalWithDepartures} /></div></div>
          <div style={card}><div>ספא (טיפולים)</div><div style={{ fontSize: 28 }}><Num n={r.spaTreatments} /></div></div>
        </div>
      )}

      {r && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div style={card}>
            <h3 style={{ marginTop: 0, color: "var(--gold)" }}>סוויטות {r.targetDate}</h3>
            <table style={{ width: "100%", fontSize: 14 }}>
              <thead><tr><th></th><th>חדרים</th><th>אורחים</th></tr></thead>
              <tbody>
                <tr><td>הגעות</td><td>{r.arrivals.rooms}</td><td>{r.arrivals.guests}</td></tr>
                <tr><td>עזיבות</td><td>{r.departures.rooms}</td><td>{r.departures.guests}</td></tr>
                <tr><td>ממשיכי שהייה</td><td>{r.stayovers.rooms}</td><td>{r.stayovers.guests}</td></tr>
                <tr><td>קפסולות</td><td>{r.capsules.rooms}</td><td>{r.capsules.guests}</td></tr>
              </tbody>
            </table>
            {r.sources.missingOperations && (
              <div style={{ marginTop: 8, color: "#E8C98A" }}>⚠ אין מייל תפעול ליום הזה — לחצי סנכרן מייל.</div>
            )}
          </div>
          <div style={card}>
            <h3 style={{ marginTop: 0, color: "var(--gold)" }}>מסעדה</h3>
            <div>בוקר: סוויטות <Num n={r.meals.breakfast.suites} /> · סה״כ <Num n={mealSum("breakfast")} /></div>
            <div>צהריים: ריזורט <Num n={r.meals.lunch.resort} /> · קבוצות <Num n={r.meals.lunch.groups} /> · סה״כ <Num n={mealSum("lunch")} /></div>
            <div>ערב: סוויטות <Num n={r.meals.dinner.suites} /> · ריזורט <Num n={r.meals.dinner.resort} /> · סה״כ <Num n={mealSum("dinner")} /></div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>בוקר סוויטות = HB/FB לעזיבות+ממשיכים בלבד (BB לא נשמר ב־meal_plan).</div>
          </div>
        </div>
      )}

      {r && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div style={card}>
            <h3 style={{ marginTop: 0, color: "var(--gold)" }}>ריזורט בוקר</h3>
            {(r.morning || []).map((p) => (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{p.label}</span><span>{p.guests}</span>
              </div>
            ))}
            {!r.morning?.length && <div>לא נמצא מידע</div>}
          </div>
          <div style={card}>
            <h3 style={{ marginTop: 0, color: "var(--gold)" }}>ריזורט ערב</h3>
            {(r.evening || []).map((p) => (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{p.label}</span><span>{p.guests}</span>
              </div>
            ))}
            {!r.evening?.length && <div>לא נמצא מידע</div>}
          </div>
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "var(--gold)" }}>קבוצות (ידני — אין מקור API)</h3>
        {groups.map((g, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr 70px 32px", gap: 6, marginBottom: 6 }}>
            <input value={g.name} placeholder="שם" onChange={(e) => {
              const next = [...groups]; next[i] = { ...g, name: e.target.value }; setGroups(next);
            }} />
            <input value={g.arrival} placeholder="שעת הגעה" onChange={(e) => {
              const next = [...groups]; next[i] = { ...g, arrival: e.target.value }; setGroups(next);
            }} />
            <input value={g.spa} placeholder="ספא" onChange={(e) => {
              const next = [...groups]; next[i] = { ...g, spa: e.target.value }; setGroups(next);
            }} />
            <input value={g.meals} placeholder="ארוחות" onChange={(e) => {
              const next = [...groups]; next[i] = { ...g, meals: e.target.value }; setGroups(next);
            }} />
            <input type="number" min="0" value={g.qty} onChange={(e) => {
              const next = [...groups]; next[i] = { ...g, qty: Number(e.target.value) }; setGroups(next);
            }} />
            <button type="button" title="מחק" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setGroups([...groups, { name: "", arrival: "09:00", spa: "", meals: "", qty: 0 }])}>
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
