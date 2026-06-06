// src/components/AgentQuestionnaire.js
// Questionnaire based on the original Dream Island manager profiling form (Code.gs).
// Fields: name, role, repetitive, questions, sources, tools, dream, tone, email, phone, notes.
import { useState } from "react";
import { buildDemoProfile } from "../data/demoAgentProfile";

const TONE_OPTIONS = [
  { value: "professional", label: "מקצועי ורשמי", desc: "ענייני, מדויק, ללא עיגולי פינות" },
  { value: "friendly",     label: "חברותי ותומך",  desc: "חם, מעודד, פתוח לדיאלוג" },
  { value: "concise",      label: "תמציתי וממוקד", desc: "ישר לעניין, מינימום מילים" },
  { value: "detailed",     label: "מפורט ומקיף",   desc: "הסברים נרחבים עם רקע ועיגונים" },
];

const TONE_LABEL = {
  professional: "מקצועי ורשמי",
  friendly:     "חברותי ותומך",
  concise:      "תמציתי וממוקד",
  detailed:     "מפורט ומקיף",
};

function buildSystemPrompt(f) {
  return `# זהות הסוכן
אתה עוזר AI אישי של ${f.name}, ${f.role} ב-Dream Island Resort.
תפקידך לסייע בניהול היומיומי, לנתח מצבים ולהציע פתרונות מדויקים.

# תפקיד וסמכות
${f.role}

# משימות חוזרות של המנהל
${f.repetitive || "—"}

# שאלות שחוזרות מהצוות
${f.questions || "—"}

# מקורות המידע שבהם המנהל משתמש
${f.sources || "—"}

# כלים ומערכות רלוונטיים
${f.tools || "—"}

# החזון / החלום של המנהל
${f.dream || "—"}

# סגנון מענה מועדף
${TONE_LABEL[f.tone] || "מקצועי ורשמי"}

# כללי עבודה
1. ענה תמיד בעברית בסגנון ${TONE_LABEL[f.tone] || "מקצועי"}.
2. התמקד בצרכים הספציפיים של ${f.name} ב-Dream Island.
3. כשמציע פעולה — ציין מי אחראי, מה הפעולה ומה לוח הזמנים.
4. אם חסר מידע — שאל שאלה ממוקדת אחת.
5. זכור תיקונים ממשובים קודמים ואל תחזור על טעויות.`.trim();
}

export default function AgentQuestionnaire({ user, onComplete }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    role: "",
    repetitive: "",
    questions: "",
    sources: "",
    tools: "",
    dream: "",
    tone: "",
    email: user?.email || "",
    phone: "",
    notes: "",
  });
  const [generating, setGenerating] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim())       e.name = "שדה חובה";
    if (!form.role.trim())       e.role = "שדה חובה";
    if (!form.repetitive.trim()) e.repetitive = "שדה חובה";
    if (!form.tone)              e.tone = "בחר סגנון";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const loadDemo = () => {
    const profile = buildDemoProfile(user?.id ?? "demo");
    localStorage.setItem(`agent_profile_${user?.id}`, JSON.stringify(profile));
    onComplete(profile);
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setGenerating(true);

    await new Promise((r) => setTimeout(r, 1200));

    const systemPrompt = buildSystemPrompt(form);
    const profile = {
      id: `profile_${user?.id}_${Date.now()}`,
      manager_id: user?.id,
      department: form.role,
      display_name: `סוכן של ${form.name}`,
      system_prompt: systemPrompt,
      drive_folder_url: null,
      personality_traits: { communication_style: form.tone },
      is_active: true,
      created_at: new Date().toISOString(),
      _questionnaire: form,
    };

    localStorage.setItem(`agent_profile_${user?.id}`, JSON.stringify(profile));
    setGenerating(false);
    onComplete(profile);
  };

  if (generating) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 440, gap: 20, textAlign: "center" }}>
        <div style={{ fontSize: 52 }}>🤖</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--black)", fontFamily: "Playfair Display, serif" }}>
          בונה את הסוכן שלך...
        </div>
        <div style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 340 }}>
          מנתח את הנתונים ויוצר פרופיל סוכן מותאם אישית
        </div>
        <div className="progress-bar" style={{ width: 240, marginTop: 8 }}>
          <div className="progress-fill" style={{ width: "100%", transition: "none" }} />
        </div>
      </div>
    );
  }

  const field = (label, key, placeholder, required, textarea) => (
    <div className="form-field" key={key}>
      <label>
        {label}
        {required && <span style={{ color: "#C0392B", marginRight: 4 }}>*</span>}
      </label>
      {textarea ? (
        <textarea
          rows={3}
          placeholder={placeholder}
          value={form[key]}
          onChange={set(key)}
          style={{ resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          placeholder={placeholder}
          value={form[key]}
          onChange={set(key)}
        />
      )}
      {errors[key] && (
        <div style={{ color: "#C0392B", fontSize: 11, marginTop: 4 }}>{errors[key]}</div>
      )}
    </div>
  );

  return (
    <div>
      {/* Demo shortcut */}
      <div style={{
        background: "linear-gradient(135deg, rgba(201,169,110,0.12), rgba(201,169,110,0.04))",
        border: "1px solid rgba(201,169,110,0.35)",
        borderRadius: 14, padding: "18px 22px", marginBottom: 24,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--black)", marginBottom: 4 }}>
            🎯 רוצה לראות סוכן מוכן מיד?
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            טען פרופיל דמו מלא — DreamBot עם ידע על כל 6 מחלקות המלון
          </div>
        </div>
        <button className="btn btn-primary" onClick={loadDemo} style={{ whiteSpace: "nowrap", minWidth: 140, flexShrink: 0 }}>
          ⚡ טען דמו מיידי
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>או מלא את השאלון</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>🤖</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--black)", fontFamily: "Playfair Display, serif" }}>
              אפיון הסוכן האישי שלך
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              מלא את הפרטים כדי שהסוכן ילמד לעבוד בדיוק לפי הצרכים שלך
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: 28 }}>

          {/* Section: פרטים אישיים */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            פרטים אישיים
          </div>
          <div className="form-grid">
            {field("שם מלא", "name", "לדוגמה: שירה לוי", true, false)}
            {field("תפקיד", "role", "לדוגמה: מנהלת קבלה", true, false)}
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label>אימייל</label>
              <input type="email" placeholder="manager@dreamisland.co.il" value={form.email} onChange={set("email")} dir="ltr" />
            </div>
            <div className="form-field">
              <label>טלפון</label>
              <input type="tel" placeholder="05X-XXXXXXX" value={form.phone} onChange={set("phone")} dir="ltr" />
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

          {/* Section: עבודה יומיומית */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            עבודה יומיומית
          </div>
          {field("משימות חוזרות", "repetitive", "אילו משימות אתה מבצע כמעט כל יום?\nלדוגמה: סיכום משמרת, בדיקת צ'קליסט, תיאום עם מחלקות...", true, true)}
          {field("שאלות שחוזרות מהצוות", "questions", "אילו שאלות הצוות שואל אותך לעתים קרובות?\nלדוגמה: מה לוח השמרות? מה הפרוטוקול ל...?", false, true)}
          {field("מקורות מידע", "sources", "מאיפה אתה מקבל מידע? (ווטסאפ, אקסל, מערכות, דוחות...)", false, true)}
          {field("כלים ומערכות", "tools", "אילו כלים אתה משתמש בהם? (Gmail, WhatsApp, Google Sheets...)", false, true)}

          <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

          {/* Section: חזון */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            חזון ומטרות
          </div>
          {field("החלום שלך", "dream", "מה היית רוצה שהסוכן יעזור לך להשיג? מה הייתה הצלחה עבורך?", false, true)}
          {field("הערות נוספות", "notes", "כל מידע נוסף שיעזור לסוכן להכיר אותך טוב יותר...", false, true)}

          <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

          {/* Section: סגנון */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            סגנון מענה מועדף <span style={{ color: "#C0392B" }}>*</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {TONE_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                onClick={() => setForm((f) => ({ ...f, tone: opt.value }))}
                style={{
                  padding: "14px 18px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${form.tone === opt.value ? "var(--gold)" : "var(--border)"}`,
                  background: form.tone === opt.value ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--black)", marginBottom: 4 }}>
                  {form.tone === opt.value ? "✓ " : ""}{opt.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{opt.desc}</div>
              </div>
            ))}
          </div>
          {errors.tone && (
            <div style={{ color: "#C0392B", fontSize: 11, marginTop: 8 }}>{errors.tone}</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={handleSubmit} style={{ minWidth: 180, fontSize: 15 }}>
          🚀 צור את הסוכן שלי
        </button>
      </div>
    </div>
  );
}
