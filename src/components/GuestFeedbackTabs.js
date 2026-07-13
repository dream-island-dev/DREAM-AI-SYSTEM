// src/components/GuestFeedbackTabs.js
// Guest Feedback & Sentiment Dashboard — reads guest_feedback (migration 117),
// joined to guests for name/room (Single Source of Truth, CLAUDE.md §0.5 — no
// denormalized name/room copy on guest_feedback itself). Deliberately separate
// from RequestsBoard.js (guest_alerts) — that board stays operational/actionable
// (maintenance faults, portal asks); this one is testimonial/sentiment only, so
// front-desk stops scrolling past reviews to find real requests.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import GuestSurveyForm from "./GuestSurveyForm";
import GuestClubOfferCard from "./GuestClubOfferCard";
import GuestClubBroadcastPanel from "./GuestClubBroadcastPanel";
import {
  BOT_CONFIG_SURVEY_UI_KEY,
  DEFAULT_GUEST_SURVEY_UI,
  SURVEY_MAX_CATEGORIES,
  SURVEY_MIN_CATEGORIES,
  SURVEY_SCORE_MAX,
  addSurveyCategory,
  cloneDefaultSurveyUi,
  isLowScoreSurveyRow,
  normalizeGuestSurveyUi,
  removeSurveyCategory,
  resolveSurveyCategoryScores,
  serializeGuestSurveyUi,
} from "../utils/guestSurveyUi";
import {
  BOT_CONFIG_CLUB_UI_KEY,
  cloneDefaultClubUi,
  normalizeGuestClubUi,
  serializeGuestClubUi,
} from "../utils/guestClubUi";

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
// above — different schema, different shape (1-10 stars, not sentiment).
// Preview + label editor: same GuestSurveyForm the portal uses; labels live in
// bot_config.guest_survey_ui (category keys frozen to DB columns).

function average(nums) {
  const vals = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((sum, n) => sum + n, 0) / vals.length;
}

const fieldInputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--black)",
  fontSize: 13.5, fontFamily: "inherit", textAlign: "right",
};

function SurveyPreviewModal({ ui, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="תצוגה מקדימה של הסקר"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.72)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, maxHeight: "92vh", overflow: "auto",
          borderRadius: 18,
          background: "linear-gradient(180deg, #0f172a 0%, #09090b 100%)",
          border: "1px solid rgba(212,175,55,0.28)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          padding: "18px 16px 20px",
          fontFamily: "Heebo, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
          <div style={{ color: "#D4AF37", fontWeight: 800, fontSize: 14 }}>👁️ תצוגה מקדימה — כמו בפורטל האורח</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.2)", background: "transparent",
              color: "#F8FAFC", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            סגור
          </button>
        </div>
        <GuestSurveyForm key={serializeGuestSurveyUi(ui)} ui={ui} variant="portal" previewOnly />
      </div>
    </div>
  );
}

function SurveyLabelsEditorModal({ draft, onChange, onSave, onClose, saving }) {
  const canAdd = draft.categories.length < SURVEY_MAX_CATEGORIES;
  const canRemove = draft.categories.length > SURVEY_MIN_CATEGORIES;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="עריכת תוויות סקר"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560, maxHeight: "92vh", overflow: "auto",
          borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--border)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)", padding: 20, direction: "rtl",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "var(--black)" }}>✏️ עריכת חלון הסקר</div>
          <button type="button" onClick={onClose} style={{ cursor: "pointer", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", background: "var(--ivory)", fontFamily: "inherit" }}>
            ביטול
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
          אפשר לשנות טקסטים, להוסיף קטגוריות דירוג חדשות או להסיר קיימות (מינימום {SURVEY_MIN_CATEGORIES}, מקסימום {SURVEY_MAX_CATEGORIES}).
          אחרי דירוג חיובי (ממוצע ≥8 וחוויה כללית ≥8) האורח יראה קישור להזמנת סוויטה.
          דרושה הרשאת admin / super_admin.
        </p>

        {[
          ["panel_title", "כותרת הפאנל"],
          ["overall_label", "תווית חוויה כללית"],
          ["free_text_label", "תווית טקסט חופשי"],
          ["free_text_placeholder", "Placeholder לטקסט חופשי"],
          ["submit_label", "טקסט כפתור שליחה"],
          ["suites_cta_label", "טקסט כפתור הזמנת סוויטה (אחרי ציון חיובי)"],
          ["suites_cta_url", "קישור הזמנת סוויטה"],
        ].map(([key, label]) => (
          <label key={key} style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--text-muted)" }}>{label}</div>
            <input
              value={draft[key] ?? ""}
              onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
              style={fieldInputStyle}
            />
          </label>
        ))}

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, margin: "16px 0 10px", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--black)" }}>
            קטגוריות דירוג (1–{SURVEY_SCORE_MAX}) — {draft.categories.length}/{SURVEY_MAX_CATEGORIES}
          </div>
          <button
            type="button"
            disabled={!canAdd || saving}
            onClick={() => onChange(addSurveyCategory(draft, "קטגוריה חדשה"))}
            title={!canAdd ? `הגעתם למקסימום ${SURVEY_MAX_CATEGORIES} קטגוריות` : "הוספת קטגוריית דירוג"}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--gold-dark)",
              background: canAdd ? "var(--ivory)" : "var(--card-bg)",
              color: canAdd ? "var(--gold-dark)" : "var(--text-muted)",
              fontWeight: 800, cursor: canAdd ? "pointer" : "not-allowed", fontFamily: "inherit", fontSize: 12.5,
              opacity: canAdd ? 1 : 0.55,
            }}
          >
            ＋ הוסף קטגוריה
          </button>
        </div>

        {draft.categories.map((c, idx) => (
          <div key={c.key} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
            <label style={{ flex: 1, display: "block" }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, color: "var(--text-muted)" }}>
                {c.key}
              </div>
              <input
                value={c.label}
                onChange={(e) => {
                  const categories = draft.categories.map((row, i) =>
                    i === idx ? { ...row, label: e.target.value } : row,
                  );
                  onChange({ ...draft, categories });
                }}
                style={fieldInputStyle}
              />
            </label>
            <button
              type="button"
              disabled={!canRemove || saving}
              onClick={() => onChange(removeSurveyCategory(draft, c.key))}
              title={!canRemove ? `חייבת להישאר לפחות קטגוריה אחת` : "הסרת קטגוריה"}
              style={{
                flexShrink: 0, marginBottom: 1, padding: "10px 12px", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--ivory)",
                color: canRemove ? "#C0392B" : "var(--text-muted)",
                cursor: canRemove ? "pointer" : "not-allowed", fontFamily: "inherit",
                fontWeight: 700, opacity: canRemove ? 1 : 0.45,
              }}
            >
              הסר
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            style={{
              flex: 1, minWidth: 140, padding: "12px 16px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg, var(--gold), #B8960C)", color: "var(--black)",
              fontWeight: 800, cursor: saving ? "wait" : "pointer", fontFamily: "inherit", opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "שומר…" : "💾 שמירה"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onChange(cloneDefaultSurveyUi())}
            title="איפוס לתוויות ברירת המחדל (עדיין צריך לשמור)"
            style={{
              padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--ivory)", color: "var(--text-muted)", fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            איפוס לברירת מחדל
          </button>
        </div>
      </div>
    </div>
  );
}

function ClubPreviewModal({ ui, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="תצוגה מקדימה של מועדון הלקוחות"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.72)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, maxHeight: "92vh", overflow: "auto",
          borderRadius: 18,
          background: "linear-gradient(180deg, #0f172a 0%, #09090b 100%)",
          border: "1px solid rgba(212,175,55,0.28)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          padding: "18px 16px 20px",
          fontFamily: "Heebo, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
          <div style={{ color: "#D4AF37", fontWeight: 800, fontSize: 14 }}>👁️ תצוגה מקדימה — מועדון (אחרי סקר)</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.2)", background: "transparent",
              color: "#F8FAFC", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            סגור
          </button>
        </div>
        <div style={{ color: "#F8FAFC", fontSize: 13, lineHeight: 1.7, textAlign: "center", marginBottom: 12 }}>
          תודה רבה על המשוב! 🙏
        </div>
        <GuestClubOfferCard ui={ui} previewOnly />
      </div>
    </div>
  );
}

function ClubLabelsEditorModal({ draft, onChange, onSave, onClose, saving }) {
  const fields = [
    ["title", "כותרת"],
    ["body", "טקסט גוף"],
    ["join_label", "כפתור הצטרפות"],
    ["decline_label", "כפתור סירוב"],
    ["joined_confirm", "הודעה אחרי הצטרפות"],
  ];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="עריכת תוויות מועדון"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto",
          background: "var(--card-bg)", borderRadius: 16, border: "1px solid var(--border)",
          padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14, color: "var(--black)" }}>
          ✏️ עריכת תוויות מועדון לקוחות
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {fields.map(([key, label]) => (
            <label key={key} style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
              {label}
              <textarea
                rows={key === "body" ? 3 : 2}
                value={draft[key] ?? ""}
                onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                style={{ ...fieldInputStyle, resize: "vertical", minHeight: key === "body" ? 72 : 42 }}
              />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            style={{
              padding: "10px 16px", borderRadius: 12, border: "none",
              background: "var(--gold-dark)", color: "#fff", fontWeight: 800,
              cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
            }}
          >
            {saving ? "שומר..." : "שמירה"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--card-bg)", color: "var(--black)", fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={() => onChange(cloneDefaultClubUi())}
            style={{
              padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--ivory)", color: "var(--text-muted)", fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            איפוס לברירת מחדל
          </button>
        </div>
      </div>
    </div>
  );
}

function SurveysView() {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [surveyUi, setSurveyUi] = useState(() => cloneDefaultSurveyUi());
  const [draftUi, setDraftUi] = useState(() => cloneDefaultSurveyUi());
  const [showPreview, setShowPreview] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [savingUi, setSavingUi] = useState(false);
  const [clubMembers, setClubMembers] = useState([]);
  const [clubUi, setClubUi] = useState(() => cloneDefaultClubUi());
  const [draftClubUi, setDraftClubUi] = useState(() => cloneDefaultClubUi());
  const [showClubPreview, setShowClubPreview] = useState(false);
  const [showClubEditor, setShowClubEditor] = useState(false);
  const [savingClubUi, setSavingClubUi] = useState(false);

  const showToastMsg = useCallback((type, msg) => {
    setToast({ type, msg });
  }, []);

  const fetchSurveyUi = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", BOT_CONFIG_SURVEY_UI_KEY)
      .maybeSingle();
    if (error) {
      showToastMsg("err", "שגיאה בטעינת תוויות סקר: " + error.message);
      return;
    }
    const ui = normalizeGuestSurveyUi(data?.config_value ?? DEFAULT_GUEST_SURVEY_UI);
    setSurveyUi(ui);
    setDraftUi(ui);
  }, [showToastMsg]);

  const fetchClubUi = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", BOT_CONFIG_CLUB_UI_KEY)
      .maybeSingle();
    if (error) {
      console.warn("[GuestFeedbackTabs] guest_club_ui:", error.message);
      return;
    }
    const ui = normalizeGuestClubUi(data?.config_value ?? null);
    setClubUi(ui);
    setDraftClubUi(ui);
  }, []);

  const fetchClubMembers = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("guest_club_members")
      .select("id, phone, status, opted_in_at, declined_at, source, guests(name)")
      .eq("status", "active")
      .order("opted_in_at", { ascending: false })
      .limit(100);
    if (error) {
      console.warn("[GuestFeedbackTabs] guest_club_members:", error.message);
      return;
    }
    setClubMembers(data ?? []);
  }, []);

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guest_surveys")
      .select("*, guests(name, room)")
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) showToastMsg("err", "שגיאה בטעינה: " + error.message);
    else setSurveys(data ?? []);
    setLoading(false);
  }, [showToastMsg]);

  useEffect(() => {
    fetchSurveys();
    fetchSurveyUi();
    fetchClubUi();
    fetchClubMembers();
  }, [fetchSurveys, fetchSurveyUi, fetchClubUi, fetchClubMembers]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("guest-surveys-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guest_surveys" }, () => fetchSurveys())
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_club_members" }, () => fetchClubMembers())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchSurveys, fetchClubMembers]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  async function saveSurveyUi() {
    if (savingUi) return;
    setSavingUi(true);
    const normalized = normalizeGuestSurveyUi(draftUi);
    const { error } = await supabase
      .from("bot_config")
      .upsert(
        {
          config_key: BOT_CONFIG_SURVEY_UI_KEY,
          config_value: serializeGuestSurveyUi(normalized),
          category: "general",
          label: "תוויות סקר חוויית אורח (JSON)",
        },
        { onConflict: "config_key" },
      );
    setSavingUi(false);
    if (error) {
      const msg = /permission|policy|RLS|row-level/i.test(error.message)
        ? "אין הרשאה לשמור תוויות סקר — נדרש admin / super_admin."
        : "שגיאה בשמירה: " + error.message;
      showToastMsg("err", msg);
      return;
    }
    setSurveyUi(normalized);
    setDraftUi(normalized);
    setShowEditor(false);
    showToastMsg("ok", "✅ תוויות הסקר נשמרו — האורח יראה אותן בפורטל");
  }

  async function saveClubUi() {
    if (savingClubUi) return;
    setSavingClubUi(true);
    const normalized = normalizeGuestClubUi(draftClubUi);
    const { error } = await supabase
      .from("bot_config")
      .upsert(
        {
          config_key: BOT_CONFIG_CLUB_UI_KEY,
          config_value: serializeGuestClubUi(normalized),
          category: "general",
          label: "תוויות הצטרפות למועדון לקוחות (JSON)",
        },
        { onConflict: "config_key" },
      );
    setSavingClubUi(false);
    if (error) {
      const msg = /permission|policy|RLS|row-level/i.test(error.message)
        ? "אין הרשאה לשמור תוויות מועדון — נדרש admin / super_admin."
        : "שגיאה בשמירה: " + error.message;
      showToastMsg("err", msg);
      return;
    }
    setClubUi(normalized);
    setDraftClubUi(normalized);
    setShowClubEditor(false);
    showToastMsg("ok", "✅ תוויות המועדון נשמרו — האורח יראה אותן אחרי הסקר");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRows = surveys.filter((s) => s.visit_date === todayStr);
  const todayAvgOverall = average(todayRows.map((s) => Number(s.overall_experience)));
  const todayLowCount = todayRows.filter(isLowScoreSurveyRow).length;
  const categoryAverages = surveyUi.categories.map((c) => ({
    ...c,
    avg: average(
      surveys.map((s) => resolveSurveyCategoryScores(s, [c])[0]?.score),
    ),
  }));

  const sorted = [...surveys].sort((a, b) => {
    const lowA = isLowScoreSurveyRow(a) ? 0 : 1;
    const lowB = isLowScoreSurveyRow(b) ? 0 : 1;
    if (lowA !== lowB) return lowA - lowB;
    return Number(a.overall_experience) - Number(b.overall_experience);
  });

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {showPreview && (
        <SurveyPreviewModal ui={surveyUi} onClose={() => setShowPreview(false)} />
      )}
      {showEditor && (
        <SurveyLabelsEditorModal
          draft={draftUi}
          onChange={setDraftUi}
          onSave={saveSurveyUi}
          onClose={() => { setDraftUi(surveyUi); setShowEditor(false); }}
          saving={savingUi}
        />
      )}
      {showClubPreview && (
        <ClubPreviewModal ui={clubUi} onClose={() => setShowClubPreview(false)} />
      )}
      {showClubEditor && (
        <ClubLabelsEditorModal
          draft={draftClubUi}
          onChange={setDraftClubUi}
          onSave={saveClubUi}
          onClose={() => { setDraftClubUi(clubUi); setShowClubEditor(false); }}
          saving={savingClubUi}
        />
      )}

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, alignItems: "center",
      }}>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          style={{
            padding: "10px 16px", borderRadius: 12, border: "1.5px solid var(--gold-dark)",
            background: "var(--ivory)", color: "var(--gold-dark)", fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
          }}
        >
          👁️ תצוגה מקדימה
        </button>
        <button
          type="button"
          onClick={() => { setDraftUi(normalizeGuestSurveyUi(surveyUi)); setShowEditor(true); }}
          style={{
            padding: "10px 16px", borderRadius: 12, border: "1.5px solid var(--border)",
            background: "var(--card-bg)", color: "var(--black)", fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
          }}
        >
          ✏️ עריכת תוויות
        </button>
        <button
          type="button"
          onClick={() => setShowClubPreview(true)}
          style={{
            padding: "10px 16px", borderRadius: 12, border: "1.5px solid var(--gold-dark)",
            background: "var(--ivory)", color: "var(--gold-dark)", fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
          }}
        >
          👁️ תצוגה מקדימה — מועדון
        </button>
        <button
          type="button"
          onClick={() => { setDraftClubUi(normalizeGuestClubUi(clubUi)); setShowClubEditor(true); }}
          style={{
            padding: "10px 16px", borderRadius: 12, border: "1.5px solid var(--border)",
            background: "var(--card-bg)", color: "var(--black)", fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
          }}
        >
          ✏️ עריכת מועדון
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          סקר + מועדון — עריכה לפני שליחה לאורחים. אחרי ציון חיובי יופיע קישור לסוויטות; אחרי הסקר — הצעת מועדון.
        </span>
      </div>

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
        <div className="card" style={{ padding: "14px 16px", borderInlineStart: "4px solid var(--gold-dark)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>🌴 חברי מועדון פעילים</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--black)" }}>{clubMembers.length}</div>
        </div>
      </div>

      {clubMembers.length > 0 && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--black)" }}>
            מועדון לקוחות — הצטרפו לאחרונה (עד 100)
          </div>
          <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
            {clubMembers.map((m) => (
              <div key={m.id} style={{
                display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                fontSize: 13, padding: "8px 10px", borderRadius: 10, background: "var(--ivory)",
                border: "1px solid var(--border)",
              }}>
                <span style={{ fontWeight: 700, color: "var(--black)" }}>
                  {m.guests?.name || "אורח"} · {m.phone}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {m.opted_in_at ? new Date(m.opted_in_at).toLocaleString("he-IL") : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <GuestClubBroadcastPanel
        activeCount={clubMembers.length}
        onToast={(type, msg) => showToastMsg(type, msg)}
      />

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
          אין עדיין סקרים שהוגשו — השתמשו ב«תצוגה מקדימה» כדי לראות את הטופס.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sorted.map((s) => {
            const low = isLowScoreSurveyRow(s);
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
                    חוויה כללית {s.overall_experience}/{SURVEY_SCORE_MAX}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
                  {resolveSurveyCategoryScores(s, surveyUi.categories).map((c) => (
                    <span key={c.key} style={{ fontSize: 11.5, color: "var(--text-muted)", background: "var(--ivory)", padding: "3px 8px", borderRadius: 10 }}>
                      {c.label}: {c.score != null ? `${c.score}/${SURVEY_SCORE_MAX}` : "—"}
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
