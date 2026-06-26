// src/components/InventoryImportPanel.js
// Inventory Smart-Intake Module — manager-facing document upload, AI column
// mapping (Resilient Import Agent — same machinery as ArrivalImportPanel.js:
// suggest-import-mapping Edge Function + MappingReviewPanel + import_mapping_memory),
// human-reviewed grid, commit to inventory_items via the upsert_inventory_items RPC.
//
// Three document types, picked explicitly by the manager (not auto-detected —
// confirmed: "אל תעשה לו חיים קשים, אפשר יהיה לבחור"):
//   "inventory" — fully implemented here. parLevel/restockColumn are read as
//                  plain computed values straight from the sheet (no formula-
//                  syntax parsing) — deriveParLevel() in importMapper.js
//                  recovers the target via simple arithmetic when the sheet
//                  only shows a "to restock" column instead of a target column.
//   "shifts"    — deep-links to the existing ShiftGenerator (מחולל משמרות),
//                  not reimplemented here.
//   "smart"     — generic any-document AI extraction. NOT YET BUILT — out of
//                  this pass's confirmed scope. Shown disabled with an
//                  explanation rather than hidden (CLAUDE.md §0.2).

import { useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { EditableGrid } from "./EditableGrid";
import MappingReviewPanel from "./MappingReviewPanel";
import { INVENTORY_RENEWAL_SCHEMA, buildMaskedSample, deriveParLevel } from "../utils/importMapper";

function _headerSignature(headers) {
  return [...headers].sort().join("␟");
}

const TYPE_CARDS = [
  { id: "inventory", icon: "📦", label: "חידוש מלאי",   desc: "טפסי ספירה ומחסן" },
  { id: "shifts",     icon: "🗓️", label: "סידור משמרות", desc: "אקסל סידור עובדים", badge: "קיים" },
  { id: "smart",      icon: "✨", label: "טופס חכם",     desc: "כל מסמך אחר — AI מסתדר", badge: "בקרוב" },
];

const GRID_COLS = [
  { id: "itemName",   label: "פריט",      editable: true,  w: 170 },
  { id: "unit",        label: "יחידה",     editable: true,  w: 90 },
  { id: "category",    label: "קטגוריה",   editable: true,  w: 110 },
  { id: "parLevel",    label: "יעד מלאי",  editable: true,  w: 90, gold: true },
  { id: "sourceNote",  label: "מקור היעד", editable: false, w: 220 },
];

export default function InventoryImportPanel({ onOpenScheduler }) {
  const [docType, setDocType] = useState(null); // null | "inventory" | "shifts" | "smart"

  const [locationName, setLocationName] = useState("");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState(null);
  const [mappingStage, setMappingStage] = useState("idle"); // "idle" | "suggesting" | "review"
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [gridRows, setGridRows] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const resetInventoryFlow = () => {
    setFileName(""); setRawRows(null); setMappingStage("idle");
    setAiSuggestion(null); setAiError(null); setGridRows(null);
  };

  const handleInventoryFile = useCallback(async (file) => {
    if (!file) return;
    if (!locationName.trim()) {
      showToast("err", "נא להזין שם מחסן/מיקום לפני העלאת הקובץ");
      return;
    }
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!rows.length) { showToast("err", "הקובץ ריק"); return; }

      const headers = Object.keys(rows[0]);
      setRawRows(rows);
      setMappingStage("suggesting");

      // Mapping memory: skip the AI call when this exact header set was
      // approved before. The review screen still always shows.
      const signature = _headerSignature(headers);
      let remembered = null;
      if (supabase) {
        const { data: mem } = await supabase
          .from("import_mapping_memory")
          .select("approved_mapping")
          .eq("schema_key", "inventory_renewal")
          .eq("header_signature", signature)
          .maybeSingle();
        if (mem?.approved_mapping) remembered = mem.approved_mapping;
      }

      if (remembered) {
        setAiSuggestion({
          mapping: remembered, defaults: {}, confidence: {}, engine: "memory",
          recommendations: ["✓ זוהה כפורמט קובץ שאושר בעבר — מיפוי נטען מהזיכרון, יש לאשר מחדש"],
        });
        setAiError(null);
      } else {
        try {
          const sample = buildMaskedSample(rows, headers, 3);
          const { data, error } = await supabase.functions.invoke("suggest-import-mapping", {
            body: { schemaKey: "inventory_renewal", headers, sampleRows: sample },
          });
          if (error) throw new Error(error.message);
          if (!data?.ok) throw new Error(data?.error || "מיפוי AI נכשל");
          setAiSuggestion(data);
          setAiError(null);
        } catch (e) {
          setAiSuggestion(null);
          setAiError(e.message);
        }
      }

      setMappingStage("review");
    } catch (err) {
      showToast("err", "שגיאה בקריאת הקובץ: " + err.message);
      setMappingStage("idle");
    }
  }, [locationName, showToast]);

  const handleMappingApprove = useCallback((finalMapping) => {
    if (!rawRows) return;
    const rows = rawRows
      .map((row, i) => {
        const itemName        = finalMapping.itemName        ? String(row[finalMapping.itemName] ?? "").trim()       : "";
        const currentQuantity = finalMapping.currentQuantity  ? row[finalMapping.currentQuantity]                     : "";
        const unit            = finalMapping.unit             ? String(row[finalMapping.unit] ?? "").trim()           : "";
        const category        = finalMapping.category         ? String(row[finalMapping.category] ?? "").trim()       : "";
        const rawParLevel      = finalMapping.parLevel          ? row[finalMapping.parLevel]                            : "";
        const rawRestock       = finalMapping.restockColumn     ? row[finalMapping.restockColumn]                       : "";
        const derivedPar       = deriveParLevel(currentQuantity, rawParLevel, rawRestock);
        const sourceNote = finalMapping.parLevel
          ? `מתוך עמודת יעד בקובץ: "${finalMapping.parLevel}"`
          : finalMapping.restockColumn
            ? `מחושב: "${finalMapping.currentQuantity}" + עמודת השלמה "${finalMapping.restockColumn}"`
            : "";
        return {
          _id: `row_${i}`,
          itemName, unit, category,
          parLevel: derivedPar == null ? "" : String(derivedPar),
          sourceNote,
        };
      })
      .filter((r) => r.itemName);

    if (!rows.length) {
      showToast("err", "לא נמצאו פריטים — בדוק את המיפוי או שהקובץ ריק");
      setMappingStage("review");
      return;
    }

    setGridRows(rows);
    setMappingStage("idle");

    if (supabase) {
      const signature = _headerSignature(Object.keys(rawRows[0] ?? {}));
      supabase.from("import_mapping_memory")
        .upsert(
          { schema_key: "inventory_renewal", header_signature: signature, approved_mapping: finalMapping, last_used_at: new Date().toISOString() },
          { onConflict: "schema_key,header_signature" },
        )
        .then(({ error }) => {
          if (error) showToast("err", "המיפוי לא נשמר לזיכרון (הייבוא הנוכחי לא נפגע, אך הייבוא הבא לא יציע אותו אוטומטית): " + error.message);
        });
    }
  }, [rawRows, showToast]);

  const handleMappingCancel = useCallback(() => {
    setMappingStage("idle");
    setRawRows(null);
    setAiSuggestion(null);
    setAiError(null);
    setFileName("");
  }, []);

  const handleSave = async () => {
    if (!supabase || !gridRows?.length) return;
    setSaving(true);
    try {
      const items = gridRows.map((r) => ({
        locationName,
        itemName:        r.itemName,
        unit:             r.unit || null,
        category:         r.category || null,
        parLevel:         r.parLevel === "" || r.parLevel == null ? null : Number(r.parLevel),
        sourceNote:       r.sourceNote || null,
        sourceFileName:   fileName || null,
      }));
      const { data, error } = await supabase.rpc("upsert_inventory_items", { payload: { items } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "השמירה נכשלה");
      showToast("ok", `✅ נשמרו ${data.upserted} פריטים במחסן "${locationName}"`);
      resetInventoryFlow();
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleInventoryFile(file);
  }, [handleInventoryFile]);

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10, fontWeight: 700,
          fontSize: 13, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {!docType && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
            ייבוא מסמך — בחר סוג
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {TYPE_CARDS.map((c) => (
              <div
                key={c.id}
                onClick={() => setDocType(c.id)}
                style={{
                  cursor: "pointer", border: "2px solid var(--border)", borderRadius: 12,
                  padding: "18px 12px", textAlign: "center", background: "var(--card-bg)", position: "relative",
                }}
              >
                {c.badge && (
                  <span style={{
                    position: "absolute", top: 8, left: 8, fontSize: 10, fontWeight: 700,
                    background: "var(--ivory)", color: "var(--gold-dark)", padding: "2px 8px", borderRadius: 10,
                  }}>{c.badge}</span>
                )}
                <div style={{ fontSize: 30, marginBottom: 8 }}>{c.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--black)", marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {docType && (
        <button
          onClick={() => { setDocType(null); resetInventoryFlow(); }}
          style={{ marginBottom: 16, border: "none", background: "none", color: "var(--gold-dark)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}
        >
          ← בחר סוג אחר
        </button>
      )}

      {docType === "shifts" && (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            סידור משמרות מנוהל בכלי הקיים — מחולל המשמרות.
          </div>
          <button
            onClick={onOpenScheduler}
            style={{ border: "none", borderRadius: 8, padding: "10px 18px", background: "var(--gold)", color: "#0F0F0F", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}
          >
            🪄 פתח את מחולל המשמרות
          </button>
        </div>
      )}

      {docType === "smart" && (
        <div
          title="בקרוב — בינתיים אפשר להשתמש ב'חידוש מלאי' לטפסים מבניים עם פריטים וכמויות"
          style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13, opacity: 0.7 }}
        >
          ✨ טופס חכם — בקרוב. בינתיים, מסמכי פריטים/כמויות אפשר לייבא דרך "חידוש מלאי".
        </div>
      )}

      {docType === "inventory" && (
        <div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label>מיקום / מחסן</label>
            <input
              type="text"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="לדוגמה: מחסן ראשי"
              disabled={!!rawRows}
              style={{ fontFamily: "Heebo, sans-serif" }}
            />
          </div>

          {!rawRows && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => document.getElementById("inv-file-input")?.click()}
              style={{
                border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
                background: dragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
                borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>גרור קובץ או לחץ להעלאה — Excel/CSV</div>
              <input
                id="inv-file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={(e) => handleInventoryFile(e.target.files?.[0])}
              />
            </div>
          )}

          {mappingStage === "suggesting" && (
            <div style={{ textAlign: "center", padding: 24, color: "var(--gold-dark)", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 10, marginTop: 14 }}>
              🤖 מנתח כותרות עמודות ומציע מיפוי...
            </div>
          )}

          {mappingStage === "review" && rawRows && (
            <div style={{ marginTop: 14 }}>
              <MappingReviewPanel
                schema={INVENTORY_RENEWAL_SCHEMA}
                headers={Object.keys(rawRows[0] ?? {})}
                sampleRow={rawRows[0]}
                aiSuggestion={aiSuggestion}
                aiError={aiError}
                onApprove={handleMappingApprove}
                onCancel={handleMappingCancel}
              />
            </div>
          )}

          {gridRows && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                📄 {fileName} — בדוק/י את "יעד מלאי" המחושב לכל פריט ותקן/י במידת הצורך לפני שמירה.
              </div>
              <EditableGrid columns={GRID_COLS} rows={gridRows} onRowsChange={setGridRows} selectedIds={new Set()} onSelectionChange={() => {}} />
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    flex: 1, padding: 12, borderRadius: 10, border: "none",
                    background: saving ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                    color: saving ? "var(--text-muted)" : "#0F0F0F",
                    fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "שומר..." : "✓ אשר ושמור במערכת"}
                </button>
                <button
                  onClick={resetInventoryFlow}
                  style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif", fontSize: 13, color: "var(--text-muted)" }}
                >
                  ✕ בטל
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
