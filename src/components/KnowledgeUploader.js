// src/components/KnowledgeUploader.js
// "Train your Agent" — unstructured knowledge ingestion UI for Pillar 3.
//
// Accepts: .pdf  .png  .jpg  .jpeg  .txt  .docx
// Does NOT accept: .xlsx  .csv  (use ArrivalImportPanel.js for tabular data)
//
// Pipeline per file:
//   TXT   → FileReader.text()             → isText=true  → process-knowledge
//   DOCX  → FileReader.arrayBuffer()
//           → mammoth.js (lazy import)    → isText=true  → process-knowledge
//   PDF   → FileReader.arrayBuffer()
//           → btoa(Uint8Array)            → isText=false → process-knowledge
//   IMG   → same as PDF                  → isText=false → process-knowledge
//
// All Supabase auth is handled by supabase.functions.invoke (attaches session JWT).
// Files are NEVER stored — pipeline is stateless.

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB raw (before base64 encoding)

const ACCEPT_TYPES = ".pdf,.png,.jpg,.jpeg,.txt,.docx";

const MIME_MAP = {
  "application/pdf":    { label: "PDF",  isText: false },
  "image/png":          { label: "PNG",  isText: false },
  "image/jpeg":         { label: "JPG",  isText: false },
  "image/jpg":          { label: "JPG",  isText: false },
  "text/plain":         { label: "TXT",  isText: true  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                        { label: "DOCX", isText: true  },
};

const CATEGORY_COLORS = {
  scheduling:    { bg: "#EFF6FF", color: "#2563EB" },
  communication: { bg: "#F0FDF4", color: "#16A34A" },
  safety:        { bg: "#FFF7ED", color: "#EA580C" },
  operations:    { bg: "#FAF5FF", color: "#9333EA" },
  quality:       { bg: "#FFF1F2", color: "#E11D48" },
  other:         { bg: "var(--ivory)", color: "var(--text-muted)" },
};

// ── Helper: encode ArrayBuffer to standard base64 ─────────────────────────────
// Uses btoa (Latin-1 safe) — NOT URL-safe base64. Gemini inline_data requires
// standard base64 (with + and /).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

// ── Helper: extract text from DOCX via mammoth (lazy-loaded) ─────────────────
async function extractDocxText(arrayBuffer) {
  const mammoth = await import("mammoth");
  const result  = await mammoth.extractRawText({ arrayBuffer });
  return result.value; // plain text string
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function KnowledgeUploader({ user }) {
  const [rules, setRules]         = useState([]);      // loaded from agent_memory
  const [loading, setLoading]     = useState(true);    // initial rules fetch
  const [uploading, setUploading] = useState(false);   // file currently processing
  const [dragging, setDragging]   = useState(false);
  const [toast, setToast]         = useState(null);
  const [noProfile, setNoProfile] = useState(false);   // true if manager has no dept yet
  const inputRef = useRef(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Load existing rules on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from("agent_memory")
          .select("id, rule_text, category, source_file_name, created_at")
          .eq("manager_id", user.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        setRules(data ?? []);
      } catch (err) {
        showToast("err", "שגיאה בטעינת הכללים: " + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id, showToast]);

  // ── Soft-delete a rule ──────────────────────────────────────────────────────
  const deleteRule = async (ruleId) => {
    try {
      const { error } = await supabase
        .from("agent_memory")
        .update({ is_active: false })
        .eq("id", ruleId)
        .eq("manager_id", user.id); // safety: can only delete own rules
      if (error) throw error;
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      showToast("ok", "הכלל הוסר מזיכרון הסוכן");
    } catch (err) {
      showToast("err", "שגיאה במחיקת הכלל: " + err.message);
    }
  };

  // ── Core file processing pipeline ───────────────────────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file) return;
    if (!isSupabaseConfigured || !supabase) {
      showToast("err", "Supabase לא מחובר");
      return;
    }

    // Size guard (raw bytes, before base64)
    if (file.size > MAX_FILE_BYTES) {
      showToast("err", `הקובץ גדול מדי (${Math.round(file.size / 1024 / 1024)}MB). מקסימום: 15MB`);
      return;
    }

    const mimeType = file.type || "application/octet-stream";
    const meta = MIME_MAP[mimeType] ?? MIME_MAP[mimeType.toLowerCase()];

    if (!meta) {
      showToast(
        "err",
        `סוג קובץ לא נתמך: "${file.type}". ניתן להעלות: PDF, תמונות (PNG/JPG), TXT, DOCX`
      );
      return;
    }

    setUploading(true);
    showToast("info", `מעבד את "${file.name}"... זה עשוי לקחת עד 30 שניות`);

    try {
      let content;     // string: either base64 or plain text
      let isText;

      if (mimeType === "text/plain") {
        // Plain text — read directly
        content = await file.text();
        isText  = true;
      } else if (
        mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        // DOCX — extract text via mammoth, then treat as text
        const buffer = await file.arrayBuffer();
        content = await extractDocxText(buffer);
        isText  = true;
      } else {
        // PDF or image — encode as standard base64
        const buffer = await file.arrayBuffer();
        content = arrayBufferToBase64(buffer);
        isText  = false;
      }

      if (!content || content.trim().length === 0) {
        showToast("err", "הקובץ ריק או לא ניתן לקריאה");
        return;
      }

      // POST to process-knowledge Edge Function
      // supabase.functions.invoke attaches the current user's JWT automatically
      const { data, error } = await supabase.functions.invoke("process-knowledge", {
        body: {
          fileName: file.name,
          mimeType: isText ? "text/plain" : mimeType, // normalise DOCX → text/plain
          content,
          isText,
        },
      });

      // supabase.functions.invoke sets error.message = generic "Edge Function returned
      // a non-2xx status code". The real error from the function body lives in data?.error.
      // Always prefer data?.error so specific handlers (e.g. profile_no_department) work.
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "extraction_failed");

      const count = data.rules_extracted ?? 0;

      if (count === 0) {
        showToast("ok", `לא נמצאו כללים ניתנים לחילוץ ב-"${file.name}"`);
        return;
      }

      showToast("ok", `✅ נמצאו ${count} כללים ב-"${file.name}" — נוספו לזיכרון הסוכן`);

      // Reload rules from DB to get server-assigned IDs and timestamps
      const { data: refreshed } = await supabase
        .from("agent_memory")
        .select("id, rule_text, category, source_file_name, created_at")
        .eq("manager_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(50);

      setRules(refreshed ?? []);
    } catch (err) {
      console.error("[KnowledgeUploader] processFile error:", err);
      const msg = err.message ?? "שגיאה לא ידועה";
      if (msg.includes("profile_no_department")) {
        setNoProfile(true);
        showToast("err", "יש לבחור מחלקה בהגדרות הסוכן לפני העלאת ידע");
      } else {
        showToast("err", "שגיאה בעיבוד הקובץ: " + msg);
      }
    } finally {
      setUploading(false);
    }
  }, [user?.id, showToast]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const categoryStyle = (cat) =>
    CATEGORY_COLORS[cat?.toLowerCase?.()] ?? CATEGORY_COLORS.other;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok"   ? "#E8F5EF"
                    : toast.type === "err"  ? "#FFF0EE"
                    : "rgba(201,169,110,0.12)",
          color:   toast.type === "ok"   ? "#1A7A4A"
                 : toast.type === "err"  ? "#C0392B"
                 : "var(--gold-dark)",
          border: `1px solid ${
            toast.type === "ok"  ? "#1A7A4A"
            : toast.type === "err" ? "#C0392B"
            : "var(--gold)"
          }`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* No-department warning */}
      {noProfile && (
        <div style={{
          background: "#FFF7ED", border: "1px solid #EA580C", borderRadius: 10,
          padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#EA580C", fontWeight: 600,
        }}>
          ⚠️ לסוכן אין מחלקה מוגדרת — עבור ל"פרופיל הסוכן" ובחר מחלקה תחילה.
        </div>
      )}

      {/* Memory count header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(201,169,110,0.10)", border: "1px solid var(--gold)",
          borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 700, color: "var(--gold-dark)",
        }}>
          🧠 {loading ? "טוען..." : `${rules.length} כלל${rules.length !== 1 ? "ים" : ""} בזיכרון הסוכן`}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          מקסימום 50 כללים פעילים
        </div>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
          background: dragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
          borderRadius: 16, padding: "32px 20px", textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          transition: "all 0.2s", marginBottom: 20,
          opacity: uploading ? 0.7 : 1,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 10 }}>
          {uploading ? "⏳" : "🧠"}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
          {uploading ? "מעבד את הקובץ, אנא המתן..." : "גרור קובץ לכאן או לחץ להעלאה"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
          PDF · PNG · JPG · TXT · DOCX &nbsp;·&nbsp; מקסימום 15MB
          <br />
          הסוכן ילמד את הכללים, הנהלים, והעדפות הניהול מהקובץ
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_TYPES}
          style={{ display: "none" }}
          onChange={(e) => processFile(e.target.files?.[0])}
        />
      </div>

      {/* Existing rules list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>
          טוען כללים...
        </div>
      ) : rules.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "28px 20px",
          border: "1px dashed var(--border)", borderRadius: 12,
          color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8,
        }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
          אין כללים בזיכרון עדיין.
          <br />
          העלה קובץ PDF, תמונה, או מסמך Word כדי להתחיל ללמד את הסוכן.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule) => {
            const cs = categoryStyle(rule.category);
            return (
              <div
                key={rule.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 14px", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--card-bg)",
                }}
              >
                {/* Rule text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--black)", lineHeight: 1.5, marginBottom: 5 }}>
                    {rule.rule_text}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {/* Category chip */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px",
                      borderRadius: 20, background: cs.bg, color: cs.color,
                    }}>
                      {rule.category ?? "other"}
                    </span>
                    {/* Source file */}
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      📄 {rule.source_file_name}
                    </span>
                    {/* Date */}
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {new Date(rule.created_at).toLocaleDateString("he-IL")}
                    </span>
                  </div>
                </div>
                {/* Delete button */}
                <button
                  onClick={() => deleteRule(rule.id)}
                  title="הסר כלל"
                  style={{
                    flexShrink: 0, border: "1px solid #FFD5D0",
                    background: "#FFF0EE", borderRadius: 6,
                    padding: "4px 8px", cursor: "pointer",
                    fontSize: 12, color: "#C0392B", fontFamily: "Heebo, sans-serif",
                  }}
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint */}
      {rules.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          הכללים מוזרקים אוטומטית לצ׳אט הסוכן ולמחולל הסידורים בכל פנייה חדשה.
        </div>
      )}
    </div>
  );
}
