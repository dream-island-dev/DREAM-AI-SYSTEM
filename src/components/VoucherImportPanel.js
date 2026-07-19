// src/components/VoucherImportPanel.js
// Voucher Reconciliation Engine (Yelena) — file upload + mapping approval gate.
// Backend: supabase/functions/reconcile-vouchers/index.ts (live). This panel only
// sends the two raw files as multipart/form-data — all parsing/mapping-resolution
// happens server-side. The only client responsibility is the human-approval gate:
// if the server comes back with status:"needs_mapping_review", show the AI's
// proposed mapping (MappingReviewPanel, same component ArrivalImportPanel/
// InventoryImportPanel use) for a human to confirm/edit before resubmitting.
// Nothing is written to voucher_provider_reports/voucher_easygo_records until
// every side present in the review response has an approved mapping.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import MappingReviewPanel from "./MappingReviewPanel";
import { VOUCHER_PROVIDER_SCHEMA, VOUCHER_EASYGO_SCHEMA } from "../utils/importMapper";
import { resolveVoucherStrategyUi, VOUCHER_FLOW_EXPLAINER } from "../utils/voucherReconciliationStrategies";

const SIDE_META = {
  provider: { schema: VOUCHER_PROVIDER_SCHEMA, title: "📄 דוח הספק (מה שמומש בפועל)" },
  easygo:   { schema: VOUCHER_EASYGO_SCHEMA,   title: "📄 דוח שוברים EasyGo (מה שהוזמן למימוש)" },
};

const MAPPING_SOURCE_LABELS = {
  preset:   "זיהוי אוטומטי של עמודות",
  memory:   "מיפוי שנשמר מייבוא קודם",
  explicit: "מיפוי שאושר ידנית",
};

const RECON_LABELS = [
  { key: "missing_in_provider", label: "⚠️ חסר בדוח הספק",  color: "#791F1F", bg: "#FCEBEB" },
  { key: "package_mismatch",    label: "🟠 חבילה לא תואמת", color: "#7A4A06", bg: "#FFF3DC" },
  { key: "duplicate_match",     label: "🟣 התאמה כפולה",    color: "#5B21B6", bg: "#F3E8FF" },
  { key: "missing_in_easygo",   label: "🔵 חסר ב-EasyGo",   color: "#1E40AF", bg: "#E8F0FE" },
  { key: "unparseable",         label: "⚪ לא ניתן לפענוח", color: "#4B5563", bg: "#F3F4F6" },
  { key: "matched",             label: "🟢 תואמים",         color: "#27500A", bg: "#EAF3DE" },
];

function FileDropZone({ side, label, file, onFile, dragging, setDragging }) {
  const inputId = `voucher-file-${side}`;
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(side); }}
        onDragLeave={() => setDragging(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(null);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => document.getElementById(inputId)?.click()}
        style={{
          border: `2px dashed ${dragging === side ? "var(--gold)" : "var(--border)"}`,
          background: dragging === side ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
          borderRadius: 12, padding: "20px 14px", textAlign: "center", cursor: "pointer",
        }}
      >
        {file ? (
          <>
            <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
            <div style={{ fontSize: 12.5, color: "var(--black)", fontWeight: 700, wordBreak: "break-all" }}>{file.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{Math.round(file.size / 1024)} KB</div>
            <button
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 6, background: "var(--card-bg)", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontFamily: "Heebo, sans-serif", color: "var(--text-muted)" }}
            >
              ✕ הסר
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📥</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>גרור קובץ או לחץ — Excel / CSV / PDF</div>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

export default function VoucherImportPanel({ onViewExceptions }) {
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerName, setProviderName] = useState("");

  const [easygoFile, setEasygoFile] = useState(null);
  const [providerFile, setProviderFile] = useState(null);
  const [dragging, setDragging] = useState(null);

  const [stage, setStage] = useState("idle"); // "idle" | "submitting" | "review" | "complete"
  const [review, setReview] = useState(null); // { provider?: proposal, easygo?: proposal }
  const [approvedMappings, setApprovedMappings] = useState({});
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    if (!supabase) { setProvidersLoading(false); return; }
    (async () => {
      const { data, error } = await supabase
        .from("voucher_providers")
        .select("provider_name")
        .eq("is_active", true)
        .order("provider_name");
      if (error) showToast("err", "שגיאה בטעינת רשימת הספקים: " + error.message);
      else setProviders(data ?? []);
      setProvidersLoading(false);
    })();
  }, [showToast]);

  const resetAll = () => {
    setEasygoFile(null); setProviderFile(null); setProviderName("");
    setStage("idle"); setReview(null); setApprovedMappings({}); setResult(null);
  };

  const submit = useCallback(async (explicitMappings = {}) => {
    if (!supabase) return;
    setStage("submitting");
    try {
      const form = new FormData();
      form.append("easygoFile", easygoFile);
      form.append("providerFile", providerFile);
      form.append("providerName", providerName.trim());
      if (explicitMappings.provider) form.append("providerMapping", JSON.stringify(explicitMappings.provider));
      if (explicitMappings.easygo)   form.append("easygoMapping", JSON.stringify(explicitMappings.easygo));

      const { data, error } = await supabase.functions.invoke("reconcile-vouchers", { body: form });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "reconcile_failed");

      if (data.status === "needs_mapping_review") {
        setReview(data.review);
        setApprovedMappings({});
        setStage("review");
        return;
      }

      // status === "complete"
      setResult(data);
      setStage("complete");
      showToast("ok", "✅ ההתאמה הושלמה");
    } catch (e) {
      const raw = e.message || String(e);
      const msg = raw.startsWith("parse_quality:")
        ? "לא הצלחנו לקרוא את מספרי השובר מהקובץ — " + raw.replace(/^parse_quality:\s*/, "")
        : raw;
      showToast("err", "שגיאה בהתאמה: " + msg);
      setStage(review ? "review" : "idle");
    }
  }, [easygoFile, providerFile, providerName, review, showToast]);

  const handleMappingApprove = (side, finalMapping) => {
    const updated = { ...approvedMappings, [side]: finalMapping };
    setApprovedMappings(updated);
    const stillNeeded = Object.keys(review).some((k) => !updated[k]);
    if (!stillNeeded) {
      submit(updated);
    } else {
      showToast("ok", `✓ מיפוי ${SIDE_META[side]?.title ?? side} אושר — ממתין למיפוי הצד השני`);
    }
  };

  const handleMappingCancel = () => {
    setReview(null);
    setApprovedMappings({});
    setStage("idle");
  };

  const canSubmit = !!providerName && !!easygoFile && !!providerFile;

  const strategyUi = resolveVoucherStrategyUi(providerName);

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
        {VOUCHER_FLOW_EXPLAINER}
      </p>

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

      {stage !== "complete" && (
        <>
          <div className="form-field" style={{ marginBottom: 16, maxWidth: 320 }}>
            <label>ספק שובר חיצוני</label>
            <select
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              disabled={stage === "review" || providersLoading}
              style={{ fontFamily: "Heebo, sans-serif" }}
            >
              <option value="">{providersLoading ? "טוען..." : "— בחר ספק —"}</option>
              {providers.map((p) => (
                <option key={p.provider_name} value={p.provider_name}>{p.provider_name}</option>
              ))}
            </select>
            {strategyUi && (
              <div style={{
                marginTop: 12, padding: "12px 14px", borderRadius: 10,
                background: "rgba(201,169,110,0.1)", border: "1px solid var(--border)",
                fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.65,
              }}>
                <div style={{ fontWeight: 800, color: "var(--gold-dark)", marginBottom: 6 }}>
                  כללי התאמה — {strategyUi.key}
                </div>
                <div><strong>איזיגו:</strong> {strategyUi.easygoRole}</div>
                <div><strong>דוח ספק:</strong> {strategyUi.providerRole}</div>
                <div style={{ marginTop: 6 }}><strong>מפתח שובר:</strong> {strategyUi.joinRule}</div>
                <div><strong>חבילה:</strong> {strategyUi.packageRule}</div>
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  עמודות: {strategyUi.providerColumns} ↔ {strategyUi.easygoColumns}
                  {strategyUi.filterNote ? ` · ${strategyUi.filterNote}` : ""}
                </div>
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  פורמטים: {strategyUi.acceptedFormats.join(", ").toUpperCase()} · מצב: {strategyUi.matchMode}
                </div>
              </div>
            )}
          </div>

          {stage === "idle" && (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
                <FileDropZone
                  side="easygo" label="דוח שוברים EasyGo — מספר שובר + חבילה שהוזמנה למימוש"
                  file={easygoFile} onFile={setEasygoFile}
                  dragging={dragging} setDragging={setDragging}
                />
                <FileDropZone
                  side="provider" label="דוח ספק — מה שמומש בפועל באתר הספק"
                  file={providerFile} onFile={setProviderFile}
                  dragging={dragging} setDragging={setDragging}
                />
              </div>

              <button
                onClick={() => submit()}
                disabled={!canSubmit}
                title={canSubmit ? "" : "יש לבחור ספק ולהעלות את שני הקבצים לפני ההתאמה"}
                style={{
                  border: "none", borderRadius: 10, padding: "12px 22px",
                  background: canSubmit ? "linear-gradient(135deg,var(--gold),var(--gold-dark))" : "var(--border)",
                  color: canSubmit ? "#0F0F0F" : "var(--text-muted)",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                🔄 התחל התאמה
              </button>
            </>
          )}

          {stage === "submitting" && (
            <div style={{ textAlign: "center", padding: 28, color: "var(--gold-dark)", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 10 }}>
              🤖 מעלה, מנתח ומתאים בין הדוחות...
            </div>
          )}

          {stage === "review" && review && (
            <div>
              <div style={{
                background: "#EFF6FF", border: "1px solid #93C5FD", borderRadius: 10,
                padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: "#1E40AF", lineHeight: 1.7,
              }}>
                המערכת לא הכירה את מבנה אחד הקבצים (או שניהם) — יש לאשר/לתקן את המיפוי המוצע לכל צד. לאחר אישור הצד האחרון, ההתאמה תרוץ אוטומטית.
              </div>

              {Object.entries(review).map(([side, proposal]) => {
                const meta = SIDE_META[side];
                const approved = approvedMappings[side];
                if (approved) {
                  return (
                    <div key={side} style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid #A7D8B8", background: "#E8F5EF", borderRadius: 10, fontSize: 13, color: "#1A7A4A", fontWeight: 700 }}>
                      ✓ {meta?.title ?? proposal.domainLabel} — מיפוי אושר, ממתין לצד השני...
                    </div>
                  );
                }
                const aiSuggestion = {
                  mapping: proposal.proposedMapping, defaults: proposal.defaults,
                  confidence: proposal.confidence, recommendations: proposal.recommendations,
                  engine: proposal.engine,
                };
                const aiError = proposal.engine === "none" ? (proposal.recommendations?.[0] || "הצעת מיפוי לא הייתה זמינה") : null;
                return (
                  <div key={side} style={{ marginBottom: 20 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "var(--gold-dark)", marginBottom: 8 }}>
                      {meta?.title ?? proposal.domainLabel}
                    </div>
                    <MappingReviewPanel
                      schema={meta?.schema}
                      headers={proposal.headers}
                      sampleRow={proposal.sampleRows?.[0]}
                      aiSuggestion={aiError ? null : aiSuggestion}
                      aiError={aiError}
                      onApprove={(finalMapping) => handleMappingApprove(side, finalMapping)}
                      onCancel={handleMappingCancel}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {stage === "complete" && result && (
        <div>
          <div style={{
            background: "#E8F5EF", border: "1px solid #1A7A4A", borderRadius: 10,
            padding: "14px 16px", marginBottom: 16, fontSize: 13, color: "#1A7A4A", lineHeight: 1.7,
          }}>
            ✅ ההתאמה רצה בהצלחה — ספק: <strong>{result.provider?.name}</strong>
            <br />
            שורות: {result.rowsInserted?.provider} (ספק) / {result.rowsInserted?.easygo} (EasyGo)
            {result.mappingSource && (
              <>
                <br />
                קריאת קבצים: EasyGo — {MAPPING_SOURCE_LABELS[result.mappingSource.easygo] || result.mappingSource.easygo}
                {" · "}
                ספק — {MAPPING_SOURCE_LABELS[result.mappingSource.provider] || result.mappingSource.provider}
              </>
            )}
            {result.joinEstimate && (
              <>
                <br />
                בדיקת הצלבה מקדימה: {Math.round((result.joinEstimate.hitRate || 0) * 100)}%
                ({result.joinEstimate.providerHits}/{result.joinEstimate.providerSample} שורות ספק נמצאו באיזיגו)
                {result.joinEstimate.packageMismatches > 0 && (
                  <> · {result.joinEstimate.packageMismatches} חשד לחבילה לא תואמת</>
                )}
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
            {RECON_LABELS.map(({ key, label, color, bg }) => (
              <div key={key} style={{ border: `1px solid ${color}30`, background: bg, borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{result.reconciliation?.[key] ?? 0}</div>
                <div style={{ fontSize: 11.5, color, fontWeight: 700, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onViewExceptions(result.reconciliation?.reconciliation_run_id)}
              style={{ flex: 1, border: "none", borderRadius: 10, padding: "12px 16px", background: "linear-gradient(135deg,var(--gold),var(--gold-dark))", color: "#0F0F0F", fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800, cursor: "pointer" }}
            >
              📋 עבור לדוח חריגים
            </button>
            <button
              onClick={resetAll}
              style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif", fontSize: 13, color: "var(--text-muted)" }}
            >
              🔄 ייבוא חדש
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
