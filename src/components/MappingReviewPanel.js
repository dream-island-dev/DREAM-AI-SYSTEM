// src/components/MappingReviewPanel.js
// "Review Mapping" screen — the human-approval gate of the Resilient Import
// Agent. Shows the AI's proposed column→field mapping (or an empty one, if
// the AI call failed) for the admin to confirm or override before any row is
// touched. Nothing here writes to the DB — onApprove() hands the final
// mapping + any approved defaults back to ArrivalImportPanel.js, which runs
// the existing aggregateGuestProfiles()/EditableGrid/sync_suite_arrivals path
// unchanged.

import { useState, useMemo } from "react";
import { EditableGrid } from "./EditableGrid";
import { clientSideDefault } from "../utils/importMapper";

const REQUIRED_META = {
  hard:     { label: "חיוני",     color: "#C0392B", bg: "#FFF0EE" },
  soft:     { label: "מומלץ",     color: "#B45309", bg: "#FEF3C7" },
  optional: { label: "אופציונלי", color: "#6B7280", bg: "#F3F4F6" },
};

function RequiredBadge({ level }) {
  const meta = REQUIRED_META[level] ?? REQUIRED_META.optional;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
      color: meta.color, background: meta.bg, border: `1px solid ${meta.color}40`,
      whiteSpace: "nowrap",
    }}>
      {meta.label}
    </span>
  );
}

function _buildRows(schema, headers, sampleRow, initialMapping, defaults, aiFailed) {
  return Object.entries(schema).map(([fieldKey, spec]) => {
    const sourceHeader = initialMapping?.[fieldKey] ?? "";
    // When the AI call itself failed there's no `defaults` object to read from at
    // all — fall back to the one established client-side safe default (arrivalDate
    // → today). When the AI succeeded but simply didn't propose a default for this
    // field, that's its own determination — don't second-guess it with a local one.
    const defaultInfo = defaults?.[fieldKey] ?? (aiFailed ? clientSideDefault(fieldKey) : null);
    return {
      _id:         fieldKey,
      fieldKey,
      fieldLabel:  spec.label,
      required:    spec.required,
      sourceHeader,
      sampleValue: sourceHeader ? String(sampleRow?.[sourceHeader] ?? "") : "",
      defaultInfo,
    };
  });
}

export default function MappingReviewPanel({
  schema, headers, sampleRow,
  aiSuggestion,   // { mapping, defaults, recommendations, confidence, engine } | null
  aiError,        // string | null — shown, never hidden, when the AI call itself failed
  onApprove,      // (finalMapping: Record<string,string|null>, appliedDefaults: Record<string,string>) => void
  onCancel,
}) {
  const [rows, setRows] = useState(() =>
    _buildRows(schema, headers, sampleRow, aiSuggestion?.mapping, aiSuggestion?.defaults, !!aiError)
  );

  const headerOptions = useMemo(() => [
    { value: "", label: "— לא קיים בקובץ —" },
    ...headers.map(h => ({ value: h, label: h })),
  ], [headers]);

  const COLS = useMemo(() => [
    { id: "fieldLabel",   label: "שדה במערכת",      editable: false, w: 230 },
    { id: "sourceHeader", label: "← עמודת מקור",    editable: true,  w: 200, gold: true, options: headerOptions },
    { id: "sampleValue",  label: "ערך דוגמה",       editable: false, w: 170 },
  ], [headerOptions]);

  const handleRowsChange = (next) => {
    setRows(next.map((r) => {
      const orig = rows.find(o => o._id === r._id);
      if (orig && r.sourceHeader !== orig.sourceHeader) {
        return { ...r, sampleValue: r.sourceHeader ? String(sampleRow?.[r.sourceHeader] ?? "") : "" };
      }
      return r;
    }));
  };

  // A "hard" field with literally no column assigned means zero rows could
  // ever produce a usable record for that role — block approval here, at the
  // mapping level. Per-row gaps (one row's cell happens to be empty) are a
  // data-quality issue surfaced later in the grid, never blocked here.
  const missingHard = rows.filter(r => r.required === "hard" && !r.sourceHeader);
  const canApprove  = missingHard.length === 0;

  const handleApprove = () => {
    const finalMapping = {};
    const appliedDefaults = {};
    for (const r of rows) {
      finalMapping[r.fieldKey] = r.sourceHeader || null;
      if (!r.sourceHeader && r.defaultInfo?.value) {
        appliedDefaults[r.fieldKey] = r.defaultInfo.value;
      }
    }
    onApprove(finalMapping, appliedDefaults);
  };

  return (
    <div style={{ marginBottom: 14 }}>

      {/* AI status banner — always visible, never silently skipped */}
      {aiError ? (
        <div style={{
          background: "#FFF7ED", border: "1px solid #F59E0B", borderRadius: 10,
          padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: "#92400E", lineHeight: 1.7,
        }}>
          ⚠ הצעת מיפוי אוטומטית לא הייתה זמינה: <strong>{aiError}</strong><br />
          אפשר למפות ידנית — בחר/י עמודת מקור לכל שדה בטבלה למטה.
        </div>
      ) : (
        <div style={{
          background: "#EFF6FF", border: "1px solid #93C5FD", borderRadius: 10,
          padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: "#1E40AF", lineHeight: 1.7,
        }}>
          🤖 מיפוי הוצע ע״י {aiSuggestion?.engine === "claude" ? "Claude (גיבוי)" : "Gemini"} — בדוק/י ותקן/י לפני אישור.
          {aiSuggestion?.recommendations?.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingRight: 18 }}>
              {aiSuggestion.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Mapping table — one row per target field, dropdown = source header */}
      <div style={{ marginBottom: 10 }}>
        <EditableGrid columns={COLS} rows={rows} onRowsChange={handleRowsChange} selectedIds={new Set()} onSelectionChange={() => {}} />
      </div>

      {/* Per-row required/default status, since EditableGrid itself can't show this */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {rows.map((r) => (
          <div key={r._id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <RequiredBadge level={r.required} />
            {!r.sourceHeader && r.required !== "optional" && (
              r.defaultInfo?.value ? (
                <span style={{ fontSize: 11, color: "#92400E" }}>
                  {r.fieldLabel}: ברירת מחדל "{r.defaultInfo.value}" — {r.defaultInfo.reason}
                </span>
              ) : r.required === "hard" ? (
                <span style={{ fontSize: 11, color: "#C0392B", fontWeight: 700 }}>
                  {r.fieldLabel}: לא מופה — לא ניתן לאשר
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "#92400E" }}>{r.fieldLabel}: לא מופה</span>
              )
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleApprove}
          disabled={!canApprove}
          title={canApprove ? "" : `שדות חיוניים ללא מיפוי: ${missingHard.map(r => r.fieldLabel).join(", ")}`}
          style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "none",
            background: canApprove ? "linear-gradient(135deg,var(--gold),var(--gold-dark))" : "var(--border)",
            color: canApprove ? "#0F0F0F" : "var(--text-muted)",
            fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
            cursor: canApprove ? "pointer" : "not-allowed",
          }}
        >
          ✓ אשר מיפוי והמשך
        </button>
        <button onClick={onCancel} style={{
          padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border)",
          background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif",
          fontSize: 13, color: "var(--text-muted)",
        }}>
          ✕ בטל
        </button>
      </div>
    </div>
  );
}
