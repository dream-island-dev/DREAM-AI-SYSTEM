// AI menu import UI — website sync, camera/upload, special menu, review before draft apply.

import { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  MENU_IMPORT_ACCEPT,
  MENU_IMPORT_MIME,
  arrayBufferToBase64,
  ensureDraftForImport,
  extractDocxText,
  importWebsiteMenuAndApply,
  invokeRestaurantMenuImport,
  normalizeParsedMenuSections,
  replaceDraftMenuContent,
  syncMenuFromWebsite,
} from "../utils/restaurantMenuImport";
import { MENU_KIND_LABELS } from "../utils/restaurantMenu";

export default function RestaurantMenuImportPanel({ user, menuKind = "standard", onApplied, onToast }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [summary, setSummary] = useState(null);

  const resetPreview = () => {
    setPreview(null);
    setWarnings([]);
    setSummary(null);
  };

  const handleParsed = (data) => {
    const sections = normalizeParsedMenuSections(data.menu?.sections ?? []);
    if (!sections.length) {
      onToast?.("err", "לא נמצאו מנות בניתוח");
      return;
    }
    setPreview(sections);
    setWarnings(data.menu?.warnings ?? []);
    setSummary(data.summary ?? null);
    onToast?.("ok", `נותחו ${sections.length} קטגוריות · ${data.summary?.items ?? "?"} מנות — בדקו ואשרו`);
  };

  const runWebsiteSync = async () => {
    setBusy(true);
    resetPreview();
    try {
      const data = await syncMenuFromWebsite(menuKind);
      handleParsed(data);
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה בסנכרון מהאתר");
    } finally {
      setBusy(false);
    }
  };

  const runWebsiteSyncAndPublish = async () => {
    if (menuKind !== "standard") {
      onToast?.("err", "סנכרון מאתר זמין רק לתפריט רגיל");
      return;
    }
    setBusy(true);
    resetPreview();
    try {
      const result = await importWebsiteMenuAndApply("standard", user?.id);
      onToast?.("ok", `פורסם למלצרים: ${result.items} מנות מ-${result.sections} קטגוריות`);
      if (result.warnings?.length) {
        onToast?.("err", result.warnings[0]);
      }
      onApplied?.();
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה בסנכרון ופרסום");
    } finally {
      setBusy(false);
    }
  };

  const processFile = useCallback(async (file) => {
    if (!file || !supabase) return;
    const mime = file.type?.toLowerCase() || "";
    const meta = MENU_IMPORT_MIME[mime];
    if (!meta) {
      onToast?.("err", "סוג קובץ לא נתמך — PDF, תמונה, TXT או DOCX");
      return;
    }

    setBusy(true);
    resetPreview();
    try {
      let content;
      let isText = meta.isText;
      if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const buf = await file.arrayBuffer();
        content = await extractDocxText(buf);
        isText = true;
      } else if (meta.isText) {
        content = await file.text();
      } else {
        const buf = await file.arrayBuffer();
        content = arrayBufferToBase64(buf);
        isText = false;
      }

      const data = await invokeRestaurantMenuImport({
        mode: "upload",
        menu_kind: menuKind,
        fileName: file.name,
        mimeType: isText ? "text/plain" : mime,
        content,
        isText,
      });
      handleParsed(data);
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה בניתוח הקובץ");
    } finally {
      setBusy(false);
    }
  }, [menuKind, onToast]);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const applyToDraft = async () => {
    if (!preview?.length) return;
    setBusy(true);
    try {
      const version = await ensureDraftForImport(menuKind);
      const stats = await replaceDraftMenuContent(version.id, preview);
      onToast?.("ok", `הוחל על טיוטה: ${stats.sections} קטגוריות, ${stats.items} מנות — לחצו «פרסם»`);
      resetPreview();
      onApplied?.();
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה בהחלה על טיוטה");
    } finally {
      setBusy(false);
    }
  };

  const previewItems = preview?.flatMap((s) => s.items.map((i) => ({ ...i, sectionName: s.name }))) ?? [];
  const kindLabel = MENU_KIND_LABELS[menuKind] ?? menuKind;

  return (
    <div style={{
      marginBottom: 14, padding: "14px 16px", borderRadius: 12,
      border: "1px solid rgba(0,128,128,0.25)", background: "rgba(0,128,128,0.05)",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#006666", marginBottom: 4 }}>
        ✨ ייבוא תפריט חכם — {kindLabel}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {menuKind === "standard"
          ? "סנכרון מאתר ערמונים (אחד-לאחד) או העלאת קובץ — יופיע בטאב הזמנה אחרי פרסום."
          : "צלמו או העלו תפריט ספיישל — AI מנתח → פרסום → המלצרים יכולים לעבור ל«תפריט ספיישל»."}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {menuKind === "standard" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={runWebsiteSyncAndPublish}
              style={{ ...actionBtnStyle, background: "#1A7A4A", color: "#fff", border: "none" }}
            >
              {busy ? "מנתח…" : "⚡ סנכרן מאתר ופרסם למלצרים"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={runWebsiteSync}
              style={actionBtnStyle}
            >
              🌐 תצוגה מקדימה מהאתר
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          style={actionBtnStyle}
        >
          📷 צלם תפריט
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          style={actionBtnStyle}
        >
          📄 העלה קובץ
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onFileChange}
      />
      <input
        ref={fileRef}
        type="file"
        accept={MENU_IMPORT_ACCEPT}
        style={{ display: "none" }}
        onChange={onFileChange}
      />

      {summary && (
        <div style={{ fontSize: 12, color: "#006666", marginBottom: 8 }}>
          מקור: {summary.source} · {summary.items} מנות
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{
          fontSize: 11.5, color: "#9A7209", background: "rgba(180,83,9,0.1)",
          padding: "8px 10px", borderRadius: 8, marginBottom: 10, lineHeight: 1.45,
        }}>
          {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      )}

      {previewItems.length > 0 && (
        <>
          <div style={{
            maxHeight: 220, overflowY: "auto", marginBottom: 10,
            border: "1px solid var(--border)", borderRadius: 8, background: "#fff",
          }}>
            {previewItems.slice(0, 40).map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                style={{
                  padding: "7px 10px", fontSize: 12, borderBottom: "1px solid var(--border)",
                  display: "flex", justifyContent: "space-between", gap: 8,
                }}
              >
                <span>
                  <strong>{item.name}</strong>
                  <span style={{ color: "var(--text-muted)", marginRight: 6 }}>({item.sectionName})</span>
                </span>
                {item.price != null && <span>₪{item.price}</span>}
              </div>
            ))}
            {previewItems.length > 40 && (
              <div style={{ padding: 8, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                +{previewItems.length - 40} מנות נוספות
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={busy}
              onClick={applyToDraft}
              style={{
                flex: 1, minWidth: 160, padding: "11px 16px", borderRadius: 10, border: "none",
                background: "#1A7A4A", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: busy ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
              }}
            >
              ✓ החל על טיוטה
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={resetPreview}
              style={{
                padding: "11px 16px", borderRadius: 10, border: "1px solid var(--border)",
                background: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif",
              }}
            >
              בטל
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const actionBtnStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1.5px solid rgba(0,128,128,0.35)",
  background: "#fff",
  color: "#006666",
  fontWeight: 800,
  fontSize: 12.5,
  cursor: "pointer",
  fontFamily: "Heebo, sans-serif",
};
