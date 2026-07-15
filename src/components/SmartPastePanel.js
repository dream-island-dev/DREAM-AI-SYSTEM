// SmartPastePanel — raw text paste → parse-raw-paste → fuzzy match → staff review.
import { useState } from "react";
import { supabase } from "../supabaseClient";
import {
  classifySmartPasteCandidates,
  SCENARIO_META,
  candidateToImportFields,
  computeMissingEnrichFields,
} from "../utils/smartPastePipeline";
import { buildEnrichGuestPatch } from "../utils/guestImportIntelligence";
import { normalizeGuestPhoneEdit } from "../utils/ezgoParser";

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function ScenarioCard({ item, onEnrich, onCreateDayGuest, busy }) {
  const meta = SCENARIO_META[item.scenario];
  const c = item.candidate;

  return (
    <div style={{
      border: `1.5px solid ${meta.color}40`,
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 12,
      background: meta.bg,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <span style={{ fontWeight: 800, color: meta.color, fontSize: 14 }}>{meta.title}</span>
        <span style={{
          marginRight: "auto", fontSize: 10, fontWeight: 700,
          padding: "2px 8px", borderRadius: 20,
          background: c.guest_type === "day_guest" ? "#FEF3C7" : "#DBEAFE",
          color: c.guest_type === "day_guest" ? "#92400E" : "#1E40AF",
        }}>
          {c.guest_type === "day_guest" ? "בילוי יומי" : "סוויטה"}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
        {c.guest_name || "(ללא שם)"}
        {c.phone_raw ? ` · ${c.phone_raw}` : ""}
      </div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
        {c.guest_type_reason}
        {c.meal_plan_label ? ` · ${c.meal_plan_label}` : ""}
        {c.spa_time ? ` · ספא ${c.spa_time}` : ""}
        {c.order_number ? ` · הזמנה ${c.order_number}` : ""}
      </div>

      {item.scenario === "sync_enrich" && item.bestMatch && (
        <>
          <div style={{ fontSize: 12, marginBottom: 8, color: "#333" }}>
            תואם ב-DB: <strong>{item.bestMatch.name}</strong>
            {item.bestMatch.room ? ` · ${item.bestMatch.room}` : ""}
            {" "}(דמיון {(item.bestMatch.similarity_score * 100).toFixed(0)}%)
          </div>
          {item.missing.labels.length > 0 ? (
            <ul style={{ margin: "0 0 10px", paddingRight: 18, fontSize: 12 }}>
              {item.missing.labels.map((l) => <li key={l}>{l}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
              אין שדות חדשים להשלמה — הפרופיל כבר מכיל את המידע מהדוח.
            </div>
          )}
          <button
            type="button"
            disabled={busy || item.missing.labels.length === 0}
            title={item.missing.labels.length === 0 ? "אין מה להשלים" : "ממלא רק שדות ריקים בפרופיל"}
            onClick={() => onEnrich(item)}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "none", cursor: busy ? "wait" : "pointer",
              background: item.missing.labels.length === 0 ? "#ccc" : "var(--gold,#C9A96E)",
              color: "#fff", fontWeight: 700, fontSize: 13,
            }}
          >
            {busy ? "⏳ שומר..." : "אשר להשלמת מידע"}
          </button>
        </>
      )}

      {item.scenario === "suite_missing_alert" && (
        <div style={{
          fontSize: 13, fontWeight: 800, color: "#B91C1C",
          padding: "10px 12px", borderRadius: 8, background: "#FFF5F5",
          border: "1px solid #FECACA",
        }}>
          אורח סוויטה מופיע בדוח אך לא נמצא במערכת!
        </div>
      )}

      {item.scenario === "day_guest_optional" && (
        <>
          <div style={{ fontSize: 12, color: "#78350F", marginBottom: 10 }}>
            אורח יום — ללא סנכרון אוטומטי. ניתן ליצור פרופיל ידנית.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCreateDayGuest(item)}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "1px solid #D97706",
              background: "#FFFBEB", color: "#92400E", fontWeight: 700, fontSize: 13,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "⏳ יוצר..." : "צור פרופיל אורח חדש לבילוי יומי"}
          </button>
        </>
      )}
    </div>
  );
}

export default function SmartPastePanel({ showToast }) {
  const [rawText, setRawText] = useState("");
  const [contextDate, setContextDate] = useState(todayYmd());
  const [loading, setLoading] = useState(false);
  const [classified, setClassified] = useState([]);
  const [parseMeta, setParseMeta] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  async function handleAnalyze() {
    if (!rawText.trim()) {
      showToast?.("הדבק טקסט לניתוח", "err");
      return;
    }
    setLoading(true);
    setClassified([]);
    setParseMeta(null);
    try {
      const { data, error } = await supabase.functions.invoke("parse-raw-paste", {
        body: { raw_text: rawText, context_date: contextDate || null },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "שגיאה בניתוח");

      setParseMeta({
        engine: data.engine,
        source_format: data.source_format,
        warnings: data.warnings ?? [],
        count: data.candidates?.length ?? 0,
      });

      const rows = await classifySmartPasteCandidates(supabase, data.candidates ?? []);
      setClassified(rows);
      if (!rows.length) showToast?.("לא זוהו מועמדים בטקסט", "err");
    } catch (e) {
      showToast?.(e.message || "שגיאה", "err");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnrich(item) {
    if (!item.bestMatch?.id) return;
    setBusyKey(item.candidate.id);
    try {
      const patch = buildEnrichGuestPatch(
        candidateToImportFields(item.candidate),
        item.bestMatch,
      );
      if (!Object.keys(patch).length) {
        showToast?.("אין שדות להשלמה", "err");
        return;
      }
      const { error } = await supabase
        .from("guests")
        .update(patch)
        .eq("id", item.bestMatch.id);
      if (error) throw error;

      const refreshed = computeMissingEnrichFields(item.candidate, { ...item.bestMatch, ...patch });
      setClassified((prev) => prev.map((row) =>
        row.candidate.id === item.candidate.id
          ? { ...row, bestMatch: { ...row.bestMatch, ...patch }, missing: refreshed }
          : row,
      ));
      showToast?.(`✓ הושלם לפרופיל ${item.bestMatch.name}`);
    } catch (e) {
      showToast?.(e.message || "שגיאת שמירה", "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateDayGuest(item) {
    const c = item.candidate;
    if (!c.guest_name && !c.phone_raw) {
      showToast?.("חסר שם או טלפון ליצירת פרופיל", "err");
      return;
    }
    setBusyKey(item.candidate.id);
    try {
      const row = {
        name: c.guest_name || "אורח יום",
        phone: c.phone_raw ? normalizeGuestPhoneEdit(c.phone_raw) : null,
        arrival_date: c.arrival_date || contextDate || todayYmd(),
        room_type: "day_guest",
        room: c.package_label?.includes("2") ? "Premium Day 2" : "Premium Day 1",
        status: "expected",
        meal_plan: c.meal_plan && c.meal_plan !== "none" ? c.meal_plan : "none",
        spa_date: c.spa_date || null,
        spa_time: c.spa_time || null,
        order_number: c.order_number || null,
      };
      const { error } = await supabase.from("guests").insert(row);
      if (error) throw error;
      showToast?.(`✓ נוצר פרופיל בילוי יומי — ${row.name}`);
    } catch (e) {
      showToast?.(e.message || "שגיאה ביצירה", "err");
    } finally {
      setBusyKey(null);
    }
  }

  const grouped = {
    sync_enrich: classified.filter((x) => x.scenario === "sync_enrich"),
    suite_missing_alert: classified.filter((x) => x.scenario === "suite_missing_alert"),
    day_guest_optional: classified.filter((x) => x.scenario === "day_guest_optional"),
  };

  return (
    <div style={{ marginTop: 28, direction: "rtl", fontFamily: "Heebo, sans-serif" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--gold-light)", marginBottom: 4 }}>
        ✨ Smart Paste — הדבקה חכמה
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 12 }}>
        הדבק טקסט מ-EZGO, מייל או לוח ספא — המערכת תחלץ, תצליב ותציע השלמת פרופיל.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-light)" }}>תאריך הקשר:</label>
        <input type="date" value={contextDate} onChange={(e) => setContextDate(e.target.value)} />
      </div>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="הדבק כאן טקסט גולמי מדוח EZGO, מייל או לוח ספא..."
        rows={8}
        style={{
          width: "100%", boxSizing: "border-box", borderRadius: 10,
          padding: 12, fontSize: 13, fontFamily: "Heebo, monospace",
          border: "1px solid rgba(201,169,110,0.35)", background: "rgba(0,0,0,0.25)",
          color: "var(--gold-light)", resize: "vertical",
        }}
      />

      <button
        type="button"
        onClick={handleAnalyze}
        disabled={loading}
        style={{
          marginTop: 10, padding: "10px 20px", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
          color: "#fff", fontWeight: 800, fontSize: 14, cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "⏳ מנתח..." : "🔍 נתח והצלב"}
      </button>

      {parseMeta && (
        <div style={{ marginTop: 14, fontSize: 12, color: "rgba(232,201,138,0.75)" }}>
          מנוע: {parseMeta.engine} · פורמט: {parseMeta.source_format} · {parseMeta.count} מועמדים
          {parseMeta.warnings.length > 0 && (
            <div style={{ color: "#F59E0B", marginTop: 4 }}>
              {parseMeta.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}

      {classified.length > 0 && (
        <div style={{ marginTop: 20 }}>
          {grouped.sync_enrich.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#1A56DB" }}>
                🔄 סנכרון והשלמה ({grouped.sync_enrich.length})
              </div>
              {grouped.sync_enrich.map((item) => (
                <ScenarioCard
                  key={item.candidate.id}
                  item={item}
                  busy={busyKey === item.candidate.id}
                  onEnrich={handleEnrich}
                  onCreateDayGuest={handleCreateDayGuest}
                />
              ))}
            </div>
          )}
          {grouped.suite_missing_alert.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#B91C1C" }}>
                ⚠️ התראות חוסר ({grouped.suite_missing_alert.length})
              </div>
              {grouped.suite_missing_alert.map((item) => (
                <ScenarioCard
                  key={item.candidate.id}
                  item={item}
                  busy={busyKey === item.candidate.id}
                  onEnrich={handleEnrich}
                  onCreateDayGuest={handleCreateDayGuest}
                />
              ))}
            </div>
          )}
          {grouped.day_guest_optional.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#A16207" }}>
                ☀️ אורחי יום אופציונליים ({grouped.day_guest_optional.length})
              </div>
              {grouped.day_guest_optional.map((item) => (
                <ScenarioCard
                  key={item.candidate.id}
                  item={item}
                  busy={busyKey === item.candidate.id}
                  onEnrich={handleEnrich}
                  onCreateDayGuest={handleCreateDayGuest}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
