// src/components/AgentQuestionnaire.js
// 7-step onboarding wizard that builds a personalised agent profile.
// Works fully offline (localStorage). Swap buildSystemPrompt() for the
// Supabase Edge Function call when ready for production.
import { useState } from "react";

const DEPARTMENTS = ["קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא", "כללי"];

const QUESTIONS = [
  {
    id: "dept_overview",
    title: "פעילות המחלקה",
    question: "תאר את הפעילות היומיומית של מחלקתך:",
    placeholder:
      "לדוגמה: ניהול צ׳ק-אין/אאוט, מתן מענה לאורחים, שמירה על רמת שירות גבוהה...",
    type: "textarea",
    required: true,
  },
  {
    id: "challenges",
    title: "אתגרים עיקריים",
    question: "מהם האתגרים הגדולים שאתה מתמודד איתם כמנהל?",
    placeholder: "פרט 2-3 אתגרים מרכזיים:\n1. ...\n2. ...\n3. ...",
    type: "textarea",
    required: true,
  },
  {
    id: "kpis",
    title: "מדדי הצלחה (KPI)",
    question: "אילו מדדים חשובים לך לעקוב עבור הצלחת המחלקה?",
    placeholder:
      "לדוגמה: שביעות רצון אורחים, זמן תגובה לקריאות, אחוז ביצוע צ׳קליסט יומי...",
    type: "textarea",
    required: false,
  },
  {
    id: "communication_style",
    title: "סגנון תקשורת",
    question: "איזה סגנון תשובות אתה מעדיף מהסוכן?",
    type: "radio",
    required: true,
    options: [
      {
        value: "formal",
        label: "רשמי ומקצועי",
        desc: "מדויק, ממוקד, ללא עיגולי פינות",
      },
      {
        value: "friendly",
        label: "חברותי ותומך",
        desc: "חם, מעודד, פתוח לדיאלוג",
      },
      {
        value: "concise",
        label: "תמציתי וממוקד",
        desc: "ישר לעניין, מינימום מילים",
      },
      {
        value: "detailed",
        label: "מפורט ומקיף",
        desc: "הסברים נרחבים עם רקע ועיגונים",
      },
    ],
  },
  {
    id: "sensitive_topics",
    title: "נושאים רגישים",
    question: "אילו נושאים דורשים את אישורך האישי לפני כל פעולה?",
    placeholder:
      "לדוגמה: שינוי מחיר חדרים, טיפול בלקוחות VIP, בעיות כוח אדם, חריגות תקציביות...",
    type: "textarea",
    required: false,
  },
  {
    id: "agent_help_areas",
    title: "תחומי עזרה עיקריים",
    question: "במה הסוכן יוכל לסייע לך הכי הרבה?",
    placeholder:
      "לדוגמה: סיכומי משמרת, ניתוח נתונים, כתיבת דוחות, ניסוח מיילים, תזכורות...",
    type: "textarea",
    required: false,
  },
  {
    id: "drive_url",
    title: "Google Drive מחלקתי",
    question: "קישור תיקיית Google Drive המחלקתית שלך (אופציונלי):",
    placeholder: "https://drive.google.com/drive/folders/...",
    type: "url",
    required: false,
  },
];

const STYLE_MAP = {
  formal: "רשמי, מקצועי ומדויק",
  friendly: "חברותי, תומך ומעודד",
  concise: "תמציתי, ממוקד ולעניין",
  detailed: "מפורט ומקיף עם הסברים נרחבים",
};

function buildSystemPrompt(managerName, department, r) {
  return `# זהות הסוכן
אתה ${department}Bot — עוזר AI חכם ומסור של ${managerName}, מנהל/ת מחלקת ${department} במלון Dream Island.
תפקידך לסייע בניהול היומיומי: ניתוח נתונים, זיהוי בעיות, הצעת פתרונות ויצירת תוצרים מדויקים.

# אחריות המחלקה
${r.dept_overview || "—"}

# אתגרים מרכזיים
${r.challenges || "—"}

# KPIs ומדדי הצלחה
${r.kpis || "—"}

# סגנון תקשורת
${STYLE_MAP[r.communication_style] || "מקצועי ותמציתי"}

# תחומי עזרה עיקריים
${r.agent_help_areas || "—"}

# נושאים הדורשים זהירות / אישור
${r.sensitive_topics || "—"}
${
  r.drive_url
    ? `\n# חומרים מחלקתיים\nגישה לתיקיית Google Drive: ${r.drive_url}`
    : ""
}

# כללי עבודה
1. ענה תמיד בעברית, בסגנון ${STYLE_MAP[r.communication_style] || "מקצועי"}.
2. התמקד בצרכי מחלקת ${department} ב-Dream Island.
3. הצג נתונים בצורה מובנית (כותרות, רשימות, טבלאות) כשרלוונטי.
4. זכור תיקונים והעדפות שקיבלת ממשובים קודמים.
5. אל תקבל החלטות בנושאים רגישים ללא אישור ${managerName}.`.trim();
}

export default function AgentQuestionnaire({ user, onComplete }) {
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({});
  const [department, setDepartment] = useState(user?.department || "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const current = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const value = responses[current.id] ?? "";
  const canContinue =
    !current.required || (typeof value === "string" && value.trim().length > 0);

  const handleComplete = async () => {
    setError("");
    setGenerating(true);

    try {
      // Production: call Supabase Edge Function
      // const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/generate-agent-profile`;
      // const res = await fetch(EDGE_URL, { method: "POST", ... });
      // const { agentProfile } = await res.json();

      // Demo mode: build system prompt client-side
      await new Promise((r) => setTimeout(r, 1200));

      const dept = department || user?.department || "כללי";
      const systemPrompt = buildSystemPrompt(user?.name ?? "המנהל", dept, responses);

      const profile = {
        id: `profile_${user?.id}_${Date.now()}`,
        manager_id: user?.id,
        department: dept,
        display_name: `סוכן ${dept}`,
        system_prompt: systemPrompt,
        drive_folder_url: responses.drive_url || null,
        personality_traits: {
          communication_style: responses.communication_style || "formal",
        },
        is_active: true,
        created_at: new Date().toISOString(),
      };

      localStorage.setItem(
        `agent_profile_${user?.id}`,
        JSON.stringify(profile)
      );
      localStorage.setItem(
        `questionnaire_${user?.id}`,
        JSON.stringify({
          manager_id: user?.id,
          department: dept,
          responses,
          drive_folder_url: responses.drive_url || null,
          completed_at: new Date().toISOString(),
          agent_profile_id: profile.id,
        })
      );

      onComplete(profile);
    } catch (e) {
      setError("שגיאה ביצירת הפרופיל. נסה שוב.");
    } finally {
      setGenerating(false);
    }
  };

  const next = () => {
    if (!canContinue) return;
    if (isLast) handleComplete();
    else setStep((s) => s + 1);
  };

  if (generating) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 440,
          gap: 20,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 52 }}>🤖</div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "var(--black)",
            fontFamily: "Playfair Display, serif",
          }}
        >
          בונה את הסוכן שלך...
        </div>
        <div style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 340 }}>
          מנתח את הנתונים ויוצר פרופיל סוכן מותאם אישית למחלקה שלך
        </div>
        <div className="progress-bar" style={{ width: 240, marginTop: 8 }}>
          <div
            className="progress-fill"
            style={{ width: "100%", transition: "none" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <span style={{ fontSize: 32 }}>🤖</span>
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "var(--black)",
                fontFamily: "Playfair Display, serif",
              }}
            >
              הגדרת הסוכן האישי שלך
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              ענה על השאלות כדי שהסוכן יתאים את עצמו בדיוק לצרכי המחלקה שלך
            </div>
          </div>
        </div>

        {/* Department selector — shown on first step only */}
        {step === 0 && (
          <div className="form-field" style={{ marginBottom: 20 }}>
            <label>מחלקה</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "1.5px solid var(--border)",
                borderRadius: 8,
                fontFamily: "Heebo, sans-serif",
                fontSize: 14,
                color: "var(--text-main)",
                outline: "none",
                background: "var(--card-bg)",
              }}
            >
              <option value="">בחר מחלקה...</option>
              {DEPARTMENTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Step progress bar */}
        <div style={{ display: "flex", gap: 4 }}>
          {QUESTIONS.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                background: i <= step ? "var(--gold)" : "var(--border)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          שאלה {step + 1} מתוך {QUESTIONS.length}
        </div>
      </div>

      {/* Question card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: 28 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--gold-dark)",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            {current.title}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--black)",
              marginBottom: 20,
              lineHeight: 1.5,
            }}
          >
            {current.question}
          </div>

          {current.type === "textarea" && (
            <textarea
              rows={5}
              placeholder={current.placeholder}
              value={value}
              onChange={(e) =>
                setResponses((r) => ({ ...r, [current.id]: e.target.value }))
              }
              style={{
                width: "100%",
                padding: "14px 16px",
                border: "1.5px solid var(--border)",
                borderRadius: 10,
                fontFamily: "Heebo, sans-serif",
                fontSize: 14,
                color: "var(--text-main)",
                outline: "none",
                resize: "vertical",
                minHeight: 120,
                background: "var(--card-bg)",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "var(--gold)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "var(--border)")
              }
            />
          )}

          {current.type === "url" && (
            <input
              type="url"
              placeholder={current.placeholder}
              value={value}
              onChange={(e) =>
                setResponses((r) => ({ ...r, [current.id]: e.target.value }))
              }
              style={{
                width: "100%",
                padding: "14px 16px",
                border: "1.5px solid var(--border)",
                borderRadius: 10,
                fontFamily: "Heebo, sans-serif",
                fontSize: 14,
                color: "var(--text-main)",
                outline: "none",
                direction: "ltr",
                textAlign: "left",
                background: "var(--card-bg)",
              }}
            />
          )}

          {current.type === "radio" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {current.options.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() =>
                    setResponses((r) => ({
                      ...r,
                      [current.id]: opt.value,
                    }))
                  }
                  style={{
                    padding: "14px 18px",
                    borderRadius: 12,
                    cursor: "pointer",
                    border: `2px solid ${
                      value === opt.value
                        ? "var(--gold)"
                        : "var(--border)"
                    }`,
                    background:
                      value === opt.value
                        ? "rgba(201,169,110,0.08)"
                        : "var(--card-bg)",
                    transition: "all 0.2s",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: "var(--black)",
                      marginBottom: 4,
                    }}
                  >
                    {value === opt.value ? "✓ " : ""}
                    {opt.label}
                  </div>
                  <div
                    style={{ fontSize: 12, color: "var(--text-muted)" }}
                  >
                    {opt.desc}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            color: "#c0392b",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          style={{ opacity: step === 0 ? 0.35 : 1 }}
        >
          ← הקודם
        </button>
        {!current.required && !isLast && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setStep((s) => s + 1)}
            style={{ fontSize: 12, color: "var(--text-muted)" }}
          >
            דלג →
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={next}
          disabled={!canContinue && current.required}
          style={{
            opacity: canContinue || !current.required ? 1 : 0.45,
            minWidth: 150,
          }}
        >
          {isLast ? "🚀 צור סוכן!" : "הבא →"}
        </button>
      </div>
    </div>
  );
}
