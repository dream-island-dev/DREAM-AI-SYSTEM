import { useState, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import EzgoImport from "./EzgoImport";

// ── Phone normalizer (Israeli 05X → international) ────────────────────────────
function normalizePhone(raw) {
  let p = (raw || "").replace(/[\s\-\(\)]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "972" + p.slice(1);
  return p;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// N days ahead, birth year irrelevant — only month+day checked for birthday logic
function birthdayInDays(daysAhead, yr = 1985) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${yr}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function isBirthdayThisMonth(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr).getMonth() === new Date().getMonth();
}

function isBirthdayThisWeek(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const b = new Date(dateStr);
  // Compare month+day against today and next 7 days
  for (let i = 0; i <= 7; i++) {
    const check = new Date(now);
    check.setDate(now.getDate() + i);
    if (b.getMonth() === check.getMonth() && b.getDate() === check.getDate()) return true;
  }
  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// ── Mock guest data (replaced by Supabase in production) ─────────────────────
const INITIAL_GUESTS = [
  { id: 1,  name: "ישראל ישראלי",   phone: "052-1234567", email: "israel@example.com",  suite: "Jasper",   last_visit: daysAgo(3),   visit_count: 8,  birthdate: null,                   notes: "VIP",       source: "manual" },
  { id: 2,  name: "שרה כהן",         phone: "050-2345678", email: "sarah@example.com",   suite: "Amethyst", last_visit: daysAgo(15),  visit_count: 3,  birthdate: birthdayInDays(3, 1990), notes: "",          source: "manual" },
  { id: 3,  name: "דוד לוי",         phone: "054-3456789", email: "",                    suite: "Pearl",    last_visit: daysAgo(45),  visit_count: 1,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 4,  name: "מרים חזן",        phone: "058-4567890", email: "miriam@example.com",  suite: "Royal",    last_visit: daysAgo(70),  visit_count: 5,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 5,  name: "יעקב פרידמן",     phone: "052-5678901", email: "",                    suite: "Jasper",   last_visit: daysAgo(95),  visit_count: 2,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 6,  name: "רחל אברמוב",      phone: "050-6789012", email: "rachel@example.com",  suite: "Amethyst", last_visit: daysAgo(20),  visit_count: 4,  birthdate: birthdayInDays(6, 1988), notes: "",          source: "manual" },
  { id: 7,  name: "אברהם שמש",       phone: "054-7890123", email: "",                    suite: "Pearl",    last_visit: daysAgo(35),  visit_count: 1,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 8,  name: "לאה מזרחי",       phone: "058-8901234", email: "leah@example.com",    suite: "Royal",    last_visit: daysAgo(62),  visit_count: 6,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 9,  name: "נחום ביטון",      phone: "052-9012345", email: "",                    suite: "Jasper",   last_visit: daysAgo(10),  visit_count: 12, birthdate: null,                   notes: "VIP",       source: "import" },
  { id: 10, name: "רבקה גורן",       phone: "050-0123456", email: "rivka@example.com",   suite: "Diamond",  last_visit: daysAgo(80),  visit_count: 3,  birthdate: null,                   notes: "",          source: "manual" },
  { id: 11, name: "אליהו כץ",        phone: "054-1112233", email: "",                    suite: "Amethyst", last_visit: daysAgo(100), visit_count: 1,  birthdate: birthdayInDays(20, 1975), notes: "",         source: "manual" },
  { id: 12, name: "תמר גלילי",       phone: "052-4445566", email: "tamar@example.com",   suite: "Jasper",   last_visit: daysAgo(7),   visit_count: 15, birthdate: birthdayInDays(2, 1992), notes: "VIP",       source: "import" },
];

// ── Campaign definitions ──────────────────────────────────────────────────────
const CAMPAIGNS_DEF = [
  {
    id: "followup",
    icon: "💌",
    name: "מתגעגעים אליכם",
    template_name: "dream_followup_no_response",
    audienceLabel: "לא ביקרו 60+ יום",
    audience: (g) => g.filter((x) => daysSince(x.last_visit) >= 60),
    buildMsg: (first) =>
      `היי ${first}! מתגעגעים אליכם ב-Dream Island 💙\nכבר הרבה זמן לא ראינו אתכם — יש לנו חדשות נהדרות ומבצעים מיוחדים שחיכו בדיוק בשבילכם.\nנשמח לארח אתכם שוב! 🏝️`,
    accentColor: "#1565C0",
    bgColor: "#E3F2FD",
    canSchedule: true,
  },
  {
    id: "birthday",
    icon: "🎂",
    name: "יום הולדת שמח",
    template_name: "dream_special_occasion",
    audienceLabel: "יום הולדת השבוע",
    audience: (g) => g.filter((x) => isBirthdayThisWeek(x.birthdate)),
    buildMsg: (first) =>
      `יום הולדת שמח ${first}! 🎂🎉\nDream Island מאחל לך יום מיוחד מלא שמחה ואהבה.\nכמתנה קטנה מאיתנו — 15% הנחה על ביקורך הבא. השנה חגגו אצלנו! ✨`,
    accentColor: "#E65100",
    bgColor: "#FFF3E0",
    canSchedule: false,
  },
  {
    id: "seasonal",
    icon: "🌞",
    name: "מבצע עונתי",
    template_name: "dream_seasonal_offer",
    audienceLabel: "כל הלקוחות",
    audience: (g) => g,
    buildMsg: (first) =>
      `היי ${first}! קיץ חם ב-Dream Island ☀️\nחבילת Premium Day במחיר מיוחד: 499₪ כולל קוטג' פרטי, ג'קוזי, ארוחת גורמה ועוד!\nמקומות מוגבלים — להזמנה: 08-6705600 🏖️`,
    accentColor: "#6A1B9A",
    bgColor: "#F3E5F5",
    canSchedule: false,
  },
  {
    id: "upsell",
    icon: "👑",
    name: "שדרוג סוויטה",
    template_name: "dream_suite_upsell",
    audienceLabel: "אורחי Jasper / Amethyst",
    audience: (g) => g.filter((x) => x.suite === "Jasper" || x.suite === "Amethyst"),
    buildMsg: (first) =>
      `היי ${first}! בתור אורח מיוחד שלנו — יש לנו הצעה בלעדית:\nשדרוג לסוויטת Royal עם בריכה פרטית + שמפניה בהגעה ב-50% הנחה!\nהזמינו עכשיו: 08-6705600 🥂`,
    accentColor: "#1B5E20",
    bgColor: "#E8F5E9",
    canSchedule: false,
  },
];

// ── WhatsApp API — routes through Supabase Edge Function ─────────────────────
async function sendWA(to, body) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { to, message: body },
    });
    if (error) return { ok: false, error: error.message };
    return data?.ok ? { ok: true } : { ok: false, error: data?.error ?? "שגיאה" };
  }
  // Demo mode — simulate send without a real token
  await new Promise((r) => setTimeout(r, 80));
  return { ok: true };
}

// ── Styles injected into the component ───────────────────────────────────────
const MH_CSS = `
  .mh-tabs { display:flex; gap:4px; margin-bottom:24px; background:#fff; border-radius:12px; padding:4px; border:1px solid #E0D5C5; width:fit-content; }
  .mh-tab { padding:8px 22px; border-radius:8px; border:none; cursor:pointer; font-family:'Heebo',sans-serif; font-weight:700; font-size:14px; transition:all .2s; }
  .mh-tab.active { background:linear-gradient(135deg,#C9A96E,#A8843A); color:#0F0F0F; box-shadow:0 2px 10px rgba(201,169,110,.3); }
  .mh-tab:not(.active) { background:transparent; color:#8A7A6A; }
  .mh-tab:not(.active):hover { background:#F5F0E8; color:#1A1A1A; }

  .mh-filters { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
  .mh-chip { padding:6px 14px; border-radius:20px; font-family:'Heebo',sans-serif; font-weight:600; font-size:12px; cursor:pointer; transition:all .2s; border:1px solid #E0D5C5; background:#fff; color:#8A7A6A; }
  .mh-chip.active { border-color:#C9A96E; background:rgba(201,169,110,.12); color:#A8843A; }
  .mh-chip:hover:not(.active) { background:#F5F0E8; }

  .mh-campaign-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(290px,1fr)); gap:20px; }
  .mh-campaign-card { background:#fff; border-radius:14px; box-shadow:0 2px 12px rgba(0,0,0,.05); border:1px solid #E0D5C5; overflow:hidden; }
  .mh-campaign-body { padding:20px 20px 0; }
  .mh-campaign-foot { padding:12px 20px 20px; display:flex; gap:8px; }
  .mh-audience-pill { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#F5F0E8; border-radius:8px; margin-bottom:14px; }

  .mh-preview-box { background:#F5F0E8; border-radius:10px; padding:16px; margin-bottom:16px; font-size:14px; color:#1A1A1A; line-height:1.75; white-space:pre-line; }
  .mh-confirm-pill { display:flex; align-items:center; gap:10px; padding:12px 16px; background:rgba(201,169,110,.08); border-radius:10px; border:1px solid rgba(201,169,110,.2); margin-bottom:20px; }

  .mh-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1A1A1A; color:#fff; padding:12px 24px; border-radius:10px; font-size:14px; font-weight:700; z-index:9999; box-shadow:0 8px 32px rgba(0,0,0,.25); border:1px solid rgba(201,169,110,.3); white-space:nowrap; animation:mh-fadein .25s ease; }
  @keyframes mh-fadein { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

  .wa-btn { padding:6px 12px; border-radius:8px; border:1px solid #E0D5C5; background:#fff; cursor:pointer; font-size:18px; transition:all .2s; }
  .wa-btn:hover { background:#E8F5E9; border-color:#1B5E20; transform:scale(1.1); }
`;

// ── Main Component ────────────────────────────────────────────────────────────
export default function MarketingHub() {
  const [tab, setTab] = useState("guests");
  const [guests, setGuests] = useState(INITIAL_GUESTS);

  // Guest tab
  const [filter, setFilter] = useState("all");
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [addModal, setAddModal] = useState(false);
  const [showEzgo, setShowEzgo] = useState(false);
  const [newGuest, setNewGuest] = useState({ name: "", phone: "", suite: "Jasper", email: "", notes: "" });

  // Campaign tab
  const [sendModal, setSendModal] = useState(null);  // { campaign, recipients }
  const [schedModal, setSchedModal] = useState(null); // { campaign }
  const [schedDate, setSchedDate] = useState("");
  const [sending, setSending] = useState(false);
  const [sentLog, setSentLog] = useState({});        // { campaignId: count }

  const [toast, setToast] = useState("");
  const fileRef = useRef();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  // ── Filter logic ────────────────────────────────────────────────────────────
  const SUITES = [...new Set(INITIAL_GUESTS.map((g) => g.suite))].sort();

  const filteredGuests = guests.filter((g) => {
    if (suiteFilter !== "all" && g.suite !== suiteFilter) return false;
    switch (filter) {
      case "30d":      return daysSince(g.last_visit) >= 30;
      case "60d":      return daysSince(g.last_visit) >= 60;
      case "90d":      return daysSince(g.last_visit) >= 90;
      case "birthday": return isBirthdayThisMonth(g.birthdate);
      case "once":     return g.visit_count === 1;
      default:         return true;
    }
  });

  // ── CSV import ──────────────────────────────────────────────────────────────
  const handleCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split("\n").slice(1);
      const imported = lines
        .filter((l) => l.trim())
        .map((line, i) => {
          const cols = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
          const [name, phone, suite, email, notes] = cols;
          return {
            id: Date.now() + i,
            name: name || "",
            phone: phone || "",
            suite: suite || "Pearl",
            email: email || "",
            last_visit: new Date().toISOString().split("T")[0],
            visit_count: 1,
            birthdate: null,
            notes: notes || "",
            source: "import",
          };
        })
        .filter((g) => g.name && g.phone);
      setGuests((prev) => [...prev, ...imported]);
      showToast(`יובאו ${imported.length} לקוחות בהצלחה ✅`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Add guest ───────────────────────────────────────────────────────────────
  const addGuest = () => {
    if (!newGuest.name.trim() || !newGuest.phone.trim()) return;
    setGuests((prev) => [
      ...prev,
      {
        id: Date.now(),
        ...newGuest,
        last_visit: new Date().toISOString().split("T")[0],
        visit_count: 1,
        birthdate: null,
        source: "manual",
      },
    ]);
    setNewGuest({ name: "", phone: "", suite: "Jasper", email: "", notes: "" });
    setAddModal(false);
    showToast("לקוח נוסף בהצלחה ✅");
  };

  // ── Send campaign ───────────────────────────────────────────────────────────
  const sendCampaign = async () => {
    if (!sendModal) return;
    const { campaign, recipients } = sendModal;
    setSending(true);
    let success = 0;
    for (const g of recipients) {
      const firstName = g.name.split(" ")[0];
      const res = await sendWA(normalizePhone(g.phone), campaign.buildMsg(firstName));
      if (res.ok) success++;
    }
    setSentLog((prev) => ({ ...prev, [campaign.id]: (prev[campaign.id] || 0) + success }));
    setSending(false);
    setSendModal(null);
    showToast(`✅ נשלחו ${success} הודעות בהצלחה!`);
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalSentSession = Object.values(sentLog).reduce((a, b) => a + b, 0);
  const bestCampaign = CAMPAIGNS_DEF.reduce((best, c) =>
    (sentLog[c.id] || 0) > (sentLog[best?.id] || 0) ? c : best, null
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <style>{MH_CSS}</style>

      {toast && <div className="mh-toast">{toast}</div>}

      {/* Tabs */}
      <div className="mh-tabs">
        {[
          { id: "guests",    label: "👥 לקוחות" },
          { id: "campaigns", label: "📣 קמפיינים" },
          { id: "stats",     label: "📊 ביצועים" },
        ].map((t) => (
          <button
            key={t.id}
            className={`mh-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────── TAB 1: GUESTS ─────────────────────────── */}
      {tab === "guests" && (
        <div>
          {/* Filter chips */}
          <div className="mh-filters">
            {[
              { id: "all",      label: "הכל" },
              { id: "30d",      label: "לא ביקרו 30+ יום" },
              { id: "60d",      label: "לא ביקרו 60+ יום" },
              { id: "90d",      label: "לא ביקרו 90+ יום" },
              { id: "birthday", label: "🎂 יום הולדת החודש" },
              { id: "once",     label: "ביקרו פעם אחת" },
            ].map((f) => (
              <button
                key={f.id}
                className={`mh-chip ${filter === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}

            <select
              value={suiteFilter}
              onChange={(e) => setSuiteFilter(e.target.value)}
              style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid #E0D5C5", fontFamily: "Heebo, sans-serif", fontSize: 12, color: "#1A1A1A", background: "#fff", cursor: "pointer" }}
            >
              <option value="all">כל הסוויטות</option>
              {SUITES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <div style={{ marginRight: "auto", display: "flex", gap: 8 }}>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSV} />
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>
                ⬆️ ייבוא CSV
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEzgo((v) => !v)}>
                📊 {showEzgo ? "סגור ייבוא EZGO" : "ייבוא EZGO"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>
                + הוסף לקוח
              </button>
            </div>
          </div>

          {/* EZGO import panel */}
          {showEzgo && (
            <div className="card" style={{ marginBottom: 16, padding: "20px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#A8843A", marginBottom: 14 }}>
                📊 ייבוא אורחים מ-EZGO — הנתונים נשמרים ב"הזמנות"
              </div>
              <EzgoImport onImported={() => setShowEzgo(false)} />
            </div>
          )}

          <div style={{ marginBottom: 12, fontSize: 13, color: "#8A7A6A" }}>
            מציג <strong style={{ color: "#1A1A1A" }}>{filteredGuests.length}</strong> לקוחות מתוך {guests.length}
          </div>

          {/* Table */}
          <div className="card">
            <div className="card-body table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>שם</th>
                    <th>טלפון</th>
                    <th>סוויטה</th>
                    <th>ביקור אחרון</th>
                    <th>מספר ביקורים</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGuests.map((g) => {
                    const since = daysSince(g.last_visit);
                    return (
                      <tr key={g.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{g.name}</div>
                          {g.notes && (
                            <div style={{ fontSize: 11, color: "#C9A96E", fontWeight: 600 }}>{g.notes}</div>
                          )}
                          {isBirthdayThisMonth(g.birthdate) && (
                            <div style={{ fontSize: 11, color: "#E65100", fontWeight: 600 }}>🎂 יום הולדת החודש</div>
                          )}
                        </td>
                        <td style={{ direction: "ltr", textAlign: "right", color: "#555" }}>{g.phone}</td>
                        <td>
                          <span className="badge badge-gold">{g.suite}</span>
                        </td>
                        <td>
                          <div>{formatDate(g.last_visit)}</div>
                          <div style={{ fontSize: 11, color: since >= 60 ? "#C0392B" : "#8A7A6A", fontWeight: since >= 60 ? 700 : 400 }}>
                            לפני {since} ימים
                          </div>
                        </td>
                        <td style={{ fontWeight: 700, fontSize: 15 }}>{g.visit_count}×</td>
                        <td>
                          <button
                            className="wa-btn"
                            title={`שלח WhatsApp ל-${g.name}`}
                            onClick={() => window.open(`https://wa.me/${normalizePhone(g.phone)}`, "_blank")}
                          >
                            💬
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredGuests.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "#8A7A6A", padding: 40, fontSize: 14 }}>
                        לא נמצאו לקוחות עם הפילטר הנוכחי
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────── TAB 2: CAMPAIGNS ───────────────────────── */}
      {tab === "campaigns" && (
        <div className="mh-campaign-grid">
          {CAMPAIGNS_DEF.map((camp) => {
            const recipients = camp.audience(guests);
            const hasSent = sentLog[camp.id] > 0;
            return (
              <div key={camp.id} className="mh-campaign-card" style={{ borderTop: `3px solid ${camp.accentColor}` }}>
                <div className="mh-campaign-body">
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 30, width: 50, height: 50, background: camp.bgColor, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {camp.icon}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "#1A1A1A" }}>{camp.name}</div>
                      <div style={{ fontSize: 12, color: "#8A7A6A", marginTop: 2 }}>{camp.audienceLabel}</div>
                    </div>
                    {hasSent && (
                      <span style={{ marginRight: "auto", fontSize: 11, color: "#1A7A4A", fontWeight: 700, background: "#E8F5EF", padding: "3px 8px", borderRadius: 10 }}>
                        ✅ {sentLog[camp.id]}
                      </span>
                    )}
                  </div>

                  {/* Audience pill */}
                  <div className="mh-audience-pill">
                    <span style={{ fontSize: 12, color: "#8A7A6A" }}>קהל יעד:</span>
                    <span style={{ fontWeight: 900, fontSize: 22, color: camp.accentColor }}>{recipients.length}</span>
                    <span style={{ fontSize: 12, color: "#8A7A6A" }}>לקוחות</span>
                  </div>

                  {/* Template name */}
                  <div style={{ fontSize: 11, color: "#8A7A6A", marginBottom: 16 }}>
                    תבנית:{" "}
                    <code style={{ background: "#F5F0E8", padding: "2px 7px", borderRadius: 4, fontSize: 11 }}>
                      {camp.template_name}
                    </code>
                  </div>
                </div>

                <div className="mh-campaign-foot">
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={recipients.length === 0}
                    onClick={() => setSendModal({ campaign: camp, recipients })}
                  >
                    {recipients.length === 0 ? "אין קהל יעד" : "שלח עכשיו"}
                  </button>
                  {camp.canSchedule && (
                    <button className="btn btn-ghost" onClick={() => setSchedModal({ campaign: camp })}>
                      תזמן
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ────────────────────────────── TAB 3: STATS ──────────────────────────── */}
      {tab === "stats" && (
        <div>
          {/* Stat cards */}
          <div className="stat-grid" style={{ marginBottom: 28 }}>
            <div className="stat-card">
              <div className="stat-icon">👥</div>
              <div className="stat-value">{guests.length}</div>
              <div className="stat-label">סה"כ לקוחות במאגר</div>
              <div className="stat-sub" style={{ color: "#1A7A4A" }}>
                +{guests.filter((g) => g.source === "import").length} יובאו
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📤</div>
              <div className="stat-value">{totalSentSession}</div>
              <div className="stat-label">נשלח בסשן</div>
              <div className="stat-sub" style={{ color: "#1A6CC8" }}>
                {totalSentSession === 0 ? "טרם נשלח" : "ב-WhatsApp"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🏆</div>
              <div className="stat-value" style={{ fontSize: 28 }}>
                {bestCampaign && sentLog[bestCampaign.id] ? bestCampaign.icon : "—"}
              </div>
              <div className="stat-label">קמפיין מוביל</div>
              <div className="stat-sub" style={{ color: "#A8843A" }}>
                {bestCampaign && sentLog[bestCampaign.id]
                  ? bestCampaign.name
                  : "טרם נשלח קמפיין"}
              </div>
            </div>
          </div>

          {/* Campaign breakdown */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div className="card-title">📣 סיכום קמפיינים</div>
            </div>
            <div className="card-body">
              <table className="table">
                <thead>
                  <tr>
                    <th>קמפיין</th>
                    <th>קהל יעד</th>
                    <th>נשלח</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {CAMPAIGNS_DEF.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span style={{ marginLeft: 6 }}>{c.icon}</span>
                        {c.name}
                      </td>
                      <td>{c.audience(guests).length} לקוחות</td>
                      <td style={{ fontWeight: 700 }}>{sentLog[c.id] || 0}</td>
                      <td>
                        {sentLog[c.id] ? (
                          <span className="badge badge-green">נשלח</span>
                        ) : (
                          <span className="badge badge-gray">טרם נשלח</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Attention list */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">⚠️ לקוחות הדורשים תשומת לב (60+ יום)</div>
            </div>
            <div className="card-body">
              {guests
                .filter((g) => daysSince(g.last_visit) >= 60)
                .sort((a, b) => daysSince(b.last_visit) - daysSince(a.last_visit))
                .slice(0, 6)
                .map((g) => (
                  <div
                    key={g.id}
                    style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #F5F0E8" }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: "#8A7A6A" }}>{g.suite}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: "#C0392B", fontSize: 14 }}>
                      {daysSince(g.last_visit)} ימים
                    </div>
                    <button
                      className="wa-btn"
                      title="שלח WhatsApp"
                      onClick={() => window.open(`https://wa.me/${normalizePhone(g.phone)}`, "_blank")}
                    >
                      💬
                    </button>
                  </div>
                ))}
              {guests.filter((g) => daysSince(g.last_visit) >= 60).length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "#8A7A6A" }}>
                  כל הלקוחות ביקרו לאחרונה 🎉
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────── MODAL: Send Confirmation ──────────────────────────── */}
      {sendModal && (
        <div className="modal-overlay" onClick={() => !sending && setSendModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {sendModal.campaign.icon} {sendModal.campaign.name}
            </div>

            <div style={{ fontSize: 12, color: "#8A7A6A", fontWeight: 700, marginBottom: 8 }}>
              תצוגה מקדימה (לקוח לדוגמה)
            </div>
            <div className="mh-preview-box">
              {sendModal.campaign.buildMsg(
                sendModal.recipients[0]?.name?.split(" ")[0] || "אורח יקר"
              )}
            </div>

            <div className="mh-confirm-pill">
              <span style={{ fontSize: 22 }}>👥</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 20 }}>{sendModal.recipients.length} לקוחות</div>
                <div style={{ fontSize: 12, color: "#8A7A6A" }}>יקבלו הודעה זו ב-WhatsApp</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setSendModal(null)} disabled={sending}>
                ביטול
              </button>
              <button className="btn btn-primary" onClick={sendCampaign} disabled={sending}>
                {sending ? "שולח..." : "✉️ אשר ושלח"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────── MODAL: Schedule Campaign ──────────────────────────── */}
      {schedModal && (
        <div className="modal-overlay" onClick={() => setSchedModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">⏰ תזמון — {schedModal.campaign.name}</div>

            <div className="form-field">
              <label>תאריך ושעה לשליחה</label>
              <input
                type="datetime-local"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
              />
            </div>

            <div style={{ fontSize: 13, color: "#8A7A6A", marginBottom: 20, background: "#F5F0E8", padding: "10px 14px", borderRadius: 8 }}>
              הקמפיין יישלח ל-
              <strong> {schedModal.campaign.audience(guests).length} לקוחות</strong> בתאריך שנבחר.
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setSchedModal(null)}>ביטול</button>
              <button
                className="btn btn-primary"
                disabled={!schedDate}
                onClick={() => {
                  const formatted = new Date(schedDate).toLocaleString("he-IL");
                  showToast(`⏰ קמפיין תוזמן ל-${formatted}`);
                  setSchedModal(null);
                  setSchedDate("");
                }}
              >
                ⏰ תזמן קמפיין
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────── MODAL: Add Guest ──────────────────────────────────── */}
      {addModal && (
        <div className="modal-overlay" onClick={() => setAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">➕ הוספת לקוח</div>

            {[
              { key: "name",  label: "שם מלא *",              placeholder: "ישראל ישראלי" },
              { key: "phone", label: "טלפון *",                placeholder: "050-0000000" },
              { key: "email", label: "אימייל (אופציונלי)",     placeholder: "example@mail.com" },
              { key: "notes", label: "הערות (VIP, העדפות...)", placeholder: "VIP" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="form-field">
                <label>{label}</label>
                <input
                  value={newGuest[key]}
                  onChange={(e) => setNewGuest((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                />
              </div>
            ))}

            <div className="form-field">
              <label>סוויטה</label>
              <select
                value={newGuest.suite}
                onChange={(e) => setNewGuest((p) => ({ ...p, suite: e.target.value }))}
              >
                {["Jasper", "Amethyst", "Pearl", "Royal", "Diamond"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setAddModal(false)}>ביטול</button>
              <button
                className="btn btn-primary"
                disabled={!newGuest.name.trim() || !newGuest.phone.trim()}
                onClick={addGuest}
              >
                הוסף לקוח
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
