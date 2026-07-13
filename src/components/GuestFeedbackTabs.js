// src/components/GuestFeedbackTabs.js
// Guest Feedback & Sentiment Dashboard — reads guest_feedback (migration 117),
// joined to guests for name/room (Single Source of Truth, CLAUDE.md §0.5 — no
// denormalized name/room copy on guest_feedback itself). Deliberately separate
// from RequestsBoard.js (guest_alerts) — that board stays operational/actionable
// (maintenance faults, portal asks); this one is testimonial/sentiment only, so
// front-desk stops scrolling past reviews to find real requests.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const SENTIMENT_META = {
  positive: { label: "🌟 חיובי",  bg: "#E8F5EF", color: "#1A7A4A", border: "#1A7A4A" },
  negative: { label: "🔴 שלילי",  bg: "#FFF0EE", color: "#C0392B", border: "#C0392B" },
  neutral:  { label: "⚪ ניטרלי", bg: "#F5F5F5", color: "#666666", border: "#CFC6B4" },
};
// FAIL VISIBLE (CLAUDE.md §0.3): an unrecognized sentiment value must show as
// a visible warning, never silently collapse into "neutral"-looking styling.
function sentimentMeta(s) {
  return SENTIMENT_META[s] ?? { label: `⚠ ${s ?? "לא ידוע"}`, bg: "#F5F5F5", color: "#888888", border: "#CCCCCC" };
}

const SOURCE_LABEL = {
  freeform_reflection: "💬 הודעה חופשית",
  post_stay_button:    "🔘 כפתור לאחר שהות",
  severe_complaint:    "🚨 תלונה חריפה",
};

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

const TAB_ORDER = [
  { id: "negative", label: "🔴 שלילי — דורש תשומת לב" },
  { id: "positive", label: "🌟 חיובי" },
  { id: "neutral",  label: "⚪ ניטרלי" },
];

// ── Guest Experience Survey sub-tab (structured_survey — guest_surveys) ─────
// Deliberately separate list/aggregation from the free-text sentiment tabs
// above — different schema, different shape (1-5/1-10 stars, not sentiment).
const SURVEY_CATEGORY_FIELDS = [
  { key: "patio", label: "פטיו" },
  { key: "live_kitchen", label: "מטבח חי" },
  { key: "chestnut_restaurant", label: "מסעדת ערמונים" },
  { key: "service_team", label: "צוות שירות" },
  { key: "spa", label: "ספא" },
  { key: "cleaning_maintenance", label: "ניקיון ותחזוקה" },
];

/** Any category <=2 OR overall <=4 — same threshold as guest-portal-survey's negative gate. */
function isLowScoreSurvey(s) {
  if (Number(s.overall_experience) <= 4) return true;
  return SURVEY_CATEGORY_FIELDS.some((c) => Number(s[c.key]) <= 2);
}

function average(nums) {
  const vals = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((sum, n) => sum + n, 0) / vals.length;
}

function SurveysView() {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guest_surveys")
      .select("*, guests(name, room)")
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) setToast({ type: "err", msg: "שגיאה בטעינה: " + error.message });
    else setSurveys(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSurveys(); }, [fetchSurveys]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("guest-surveys-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guest_surveys" }, () => fetchSurveys())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchSurveys]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRows = surveys.filter((s) => s.visit_date === todayStr);
  const todayAvgOverall = average(todayRows.map((s) => Number(s.overall_experience)));
  const todayLowCount = todayRows.filter(isLowScoreSurvey).length;
  const categoryAverages = SURVEY_CATEGORY_FIELDS.map((c) => ({
    ...c,
    avg: average(surveys.map((s) => Number(s[c.key]))),
  }));

  // Low-score rows first (FAIL VISIBLE) — worst overall, then worst category avg.
  const sorted = [...surveys].sort((a, b) => {
    const lowA = isLowScoreSurvey(a) ? 0 : 1;
    const lowB = isLowScoreSurvey(b) ? 0 : 1;
    if (lowA !== lowB) return lowA - lowB;
    return Number(a.overall_experience) - Number(b.overall_experience);
  });

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          background: "#FFF0EE", color: "#C0392B", border: "1px solid #C0392B",
        }}>{toast.msg}</div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20,
      }}>
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>סקרים היום</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--black)" }}>{todayRows.length}</div>
        </div>
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>ממוצע חוויה כללית</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--black)" }}>
            {todayAvgOverall !== null ? todayAvgOverall.toFixed(1) : "—"}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 16px", borderInlineStart: todayLowCount ? "4px solid #C0392B" : undefined }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>ציונים נמוכים היום</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: todayLowCount ? "#C0392B" : "var(--black)" }}>{todayLowCount}</div>
        </div>
      </div>

      <div className="card" style={{ padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--black)" }}>ממוצע לפי קטגוריה (הכל)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {categoryAverages.map((c) => (
            <div key={c.key} style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {c.label}: <strong style={{ color: "var(--black)" }}>{c.avg !== null ? c.avg.toFixed(1) : "—"}</strong>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען סקרים...</div>
      ) : sorted.length === 0 ? (
        <div style={{
          textAlign: "center", padding: 48, color: "var(--text-muted)",
          background: "var(--ivory)", borderRadius: 14, border: "1px solid var(--border)",
        }}>
          אין עדיין סקרים שהוגשו.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sorted.map((s) => {
            const low = isLowScoreSurvey(s);
            return (
              <div
                key={s.id}
                className="card"
                style={{ borderInlineStart: `5px solid ${low ? "#C0392B" : "#1A7A4A"}`, padding: "16px 18px", background: "var(--card-bg)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--black)" }}>
                      {s.guests?.name || "אורח"}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                      {s.guests?.room ? `🏨 ${s.guests.room} · ` : ""}{s.visit_date}
                    </div>
                  </div>
                  <span style={{
                    padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: low ? "#FFF0EE" : "#E8F5EF", color: low ? "#C0392B" : "#1A7A4A", whiteSpace: "nowrap",
                  }}>
                    חוויה כללית {s.overall_experience}/10
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
                  {SURVEY_CATEGORY_FIELDS.map((c) => (
                    <span key={c.key} style={{ fontSize: 11.5, color: "var(--text-muted)", background: "var(--ivory)", padding: "3px 8px", borderRadius: 10 }}>
                      {c.label}: {s[c.key]}/5
                    </span>
                  ))}
                </div>

                {s.free_text && (
                  <div style={{
                    padding: 13, background: "var(--ivory)", borderRadius: 10,
                    fontSize: 14, color: "#333", lineHeight: 1.6, whiteSpace: "pre-wrap",
                    border: "1px solid var(--border)",
                  }}>
                    {s.free_text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GuestFeedbackTabs({ user }) {
  // Deep link: ?page=feedback_dashboard&tab=surveys — read once on mount.
  const [view, setView]                 = useState(() =>
    new URLSearchParams(window.location.search).get("tab") === "surveys" ? "surveys" : "feedback",
  );
  const [feedback, setFeedback]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [toast, setToast]               = useState(null);
  const [tab, setTab]                   = useState("negative"); // most actionable stream first
  const [showArchived, setShowArchived] = useState(false);
  const [archivingId, setArchivingId]   = useState(null);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guest_feedback")
      .select("*, guests(name, room)")
      .order("created_at", { ascending: false });
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setFeedback(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  // Live sync — new reviews/complaints appear without refresh (migration 117
  // adds guest_feedback to supabase_realtime). INSERT payloads are flat rows
  // (no guests(...) embed), so a fresh fetch is simplest and cheap at this
  // volume; UPDATE (archive from another tab) just patches the local row.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("guest-feedback-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guest_feedback" }, () => {
        fetchFeedback();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guest_feedback" }, (payload) => {
        setFeedback((prev) => prev.map((f) => (f.id === payload.new.id ? { ...f, ...payload.new } : f)));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchFeedback]);

  const archiveItem = async (item) => {
    setArchivingId(item.id);
    const patch = {
      status:      "archived",
      resolved_by: user?.id ?? null,
      resolved_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("guest_feedback").update(patch).eq("id", item.id);
    setArchivingId(null);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, ...patch } : f)));
    showToast("ok", "✓ סומן כטופל / בארכיון");
  };

  const bySentiment = feedback.filter((f) => f.sentiment === tab);
  const visible = showArchived ? bySentiment : bySentiment.filter((f) => f.status !== "archived");
  const openCount = (sentiment) =>
    feedback.filter((f) => f.sentiment === sentiment && f.status !== "archived").length;

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "err" ? "#FFF0EE" : "#E8F5EF",
          color:      toast.type === "err" ? "#C0392B" : "#1A7A4A",
          border: `1px solid ${toast.type === "err" ? "#C0392B" : "#1A7A4A"}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Playfair Display', serif", color: "var(--gold-dark)", margin: "0 0 4px", fontSize: 24 }}>
          💬 משוב וסנטימנט אורחים
        </h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          רשמים וביקורות כלליים על השהות — נפרד מלוח הבקשות התפעולי, כדי שהצוות בקבלה לא יגלול דרך שבחים כדי למצוא בקשה אמיתית.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setView("feedback")}
          style={{
            padding: "9px 18px", borderRadius: 20, fontSize: 13, fontWeight: 700,
            border: `1.5px solid ${view === "feedback" ? "var(--gold-dark)" : "var(--border)"}`,
            background: view === "feedback" ? "var(--ivory)" : "var(--card-bg)",
            color: view === "feedback" ? "var(--gold-dark)" : "var(--text-muted)",
            cursor: "pointer", fontFamily: "inherit", minHeight: 40,
          }}
        >
          💬 משוב חופשי
        </button>
        <button
          type="button"
          onClick={() => setView("surveys")}
          style={{
            padding: "9px 18px", borderRadius: 20, fontSize: 13, fontWeight: 700,
            border: `1.5px solid ${view === "surveys" ? "var(--gold-dark)" : "var(--border)"}`,
            background: view === "surveys" ? "var(--ivory)" : "var(--card-bg)",
            color: view === "surveys" ? "var(--gold-dark)" : "var(--text-muted)",
            cursor: "pointer", fontFamily: "inherit", minHeight: 40,
          }}
        >
          📊 סקרים
        </button>
      </div>

      {view === "surveys" ? (
        <SurveysView />
      ) : (
      <>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {TAB_ORDER.map((t) => {
          const active = tab === t.id;
          const count = openCount(t.id);
          const sm = sentimentMeta(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: "9px 18px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                border: `1.5px solid ${active ? sm.color : "var(--border)"}`,
                background: active ? sm.bg : "var(--card-bg)",
                color: active ? sm.color : "var(--text-muted)",
                cursor: "pointer", fontFamily: "inherit", minHeight: 40,
                transition: "all 0.15s ease",
              }}
            >
              {t.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}

        <label style={{
          marginInlineStart: "auto", fontSize: 13, color: "var(--text-muted)",
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
        }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            style={{ accentColor: "var(--gold)" }}
          />
          הצג גם טופלו
        </label>
        <button className="btn btn-ghost btn-sm" onClick={fetchFeedback} disabled={loading}>
          {loading ? "..." : "↺ רענון"}
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון משוב.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען משוב...</div>
      ) : visible.length === 0 ? (
        <div style={{
          textAlign: "center", padding: 48, color: "var(--text-muted)",
          background: "var(--ivory)", borderRadius: 14, border: "1px solid var(--border)",
        }}>
          {showArchived ? "אין משוב בקטגוריה זו." : "אין משוב פתוח בקטגוריה זו 🎉"}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {visible.map((f) => {
            const sm = sentimentMeta(f.sentiment);
            const archived = f.status === "archived";
            return (
              <div
                key={f.id}
                className="card"
                style={{
                  borderInlineStart: `5px solid ${sm.color}`,
                  padding: "16px 18px",
                  background: "var(--card-bg)",
                  opacity: archived ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--black)" }}>
                      {f.guests?.name || "אורח"}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                      {f.guests?.room ? `🏨 ${f.guests.room}` : ""}
                      {f.phone ? `${f.guests?.room ? "  ·  " : ""}📞 ${f.phone}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{
                      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: sm.bg, color: sm.color, whiteSpace: "nowrap",
                    }}>{sm.label}</span>
                    <span style={{
                      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: "var(--ivory)", color: "var(--text-muted)", whiteSpace: "nowrap",
                    }}>{SOURCE_LABEL[f.source] ?? f.source}</span>
                  </div>
                </div>

                <div style={{
                  margin: "12px 0", padding: 13, background: "var(--ivory)", borderRadius: 10,
                  fontSize: 14, color: "#333", lineHeight: 1.6, whiteSpace: "pre-wrap",
                  border: "1px solid var(--border)",
                }}>
                  {f.feedback_text}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {fmtTimestamp(f.created_at)}
                  </span>
                  {archived ? (
                    <span style={{ fontSize: 12, color: "#1A7A4A", fontWeight: 700 }}>
                      ✓ טופל{f.resolved_at ? ` — ${fmtTimestamp(f.resolved_at)}` : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={archivingId === f.id}
                      onClick={() => archiveItem(f)}
                      style={{
                        background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700,
                        borderRadius: 10, minHeight: 38,
                      }}
                    >
                      {archivingId === f.id ? "שומר…" : "סמן כטופל / ארכיון"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
