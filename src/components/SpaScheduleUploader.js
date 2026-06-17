// src/components/SpaScheduleUploader.js
// Spa schedule Excel parser → spa_staging review → bookings sync.
// Two-step flow: Upload & Parse → Manager Review → Write treatment_time to bookings.
import { useState, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const SUITE_MARKER = "לאורחי הסוויטות";

const SPA_ALIASES = {
  phone:          ["טלפון", "נייד", "מספר טלפון", "phone", "mobile"],
  treatment_time: ["שעה", "שעת טיפול", "שעת התחלה", "time", "hour"],
  treatment_type: ["טיפול", "שם טיפול", "סוג טיפול", "treatment", "treatment type"],
  guest_name:     ["שם אורח", "שם מלא", "שם", "לקוח", "guest name", "name"],
  package:        ["חבילה", "תוספות", "הערות", "package", "additions"],
};

const norm = (s) =>
  String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9א-׿]/g, "");

function mapHeaders(aliases, headers) {
  const map = {};
  for (const [col, al] of Object.entries(aliases)) {
    const normAl = al.map(norm);
    const found = headers.find((h) => normAl.includes(norm(h)));
    if (found) map[col] = found;
  }
  return map;
}

// Handles Excel time serials (0.375 = 09:00), JS Date, and string formats.
function normalizeTime(raw) {
  if (!raw && raw !== 0) return null;
  if (typeof raw === "number" && raw >= 0 && raw < 1) {
    const totalMin = Math.round(raw * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${String(raw.getHours()).padStart(2, "0")}:${String(raw.getMinutes()).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2})[:.h](\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 3) return `0${digits[0]}:${digits.slice(1)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const p = String(raw).replace(/[\s\-().+]/g, "");
  if (!p) return null;
  if (p.startsWith("972") && p.length >= 11) return p;
  if (p.startsWith("0") && p.length === 10) return "972" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "972" + p;
  return p.length >= 9 ? p : null;
}

const STATUS_LABEL = { matched: "נמצא ✓", no_booking: "לא ידוע", synced: "סונכרן ✅", rejected: "נדחה ✕", pending: "ממתין" };

export default function SpaScheduleUploader() {
  const [step, setStep]         = useState("upload");
  const [rawRows, setRawRows]   = useState([]);
  const [headers, setHeaders]   = useState([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy]         = useState(false);
  const [toast, setToast]       = useState(null);
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged]     = useState([]);
  const [approving,    setApproving]    = useState(new Set());
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const inputRef = useRef(null);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const parseFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
        if (!rows.length) { showToast("err", "הקובץ ריק או ללא כותרות"); return; }
        setHeaders(Object.keys(rows[0]));
        setRawRows(rows);
        setStep("upload");
      } catch (err) {
        showToast("err", "שגיאה בקריאת הקובץ: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // Derive parsed rows from rawRows + colMap
  const colMap = mapHeaders(SPA_ALIASES, headers);
  const parsedRows = rawRows
    .map((r) => {
      const phone          = normalizePhone(colMap.phone ? r[colMap.phone] : null);
      const treatment_time = normalizeTime(colMap.treatment_time ? r[colMap.treatment_time] : null);
      const treatment_type = colMap.treatment_type ? String(r[colMap.treatment_type] ?? "").trim() || null : null;
      const guest_name     = colMap.guest_name ? String(r[colMap.guest_name] ?? "").trim() || null : null;
      const raw_extras     = colMap.package ? String(r[colMap.package] ?? "").trim() || null : null;
      return { phone, treatment_time, treatment_type, guest_name, raw_extras };
    })
    .filter((r) => r.phone && r.treatment_time);

  // ── Stage: insert to spa_staging + match against bookings ──────────────────
  const handleStage = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    if (!parsedRows.length) return showToast("err", "אין שורות תקינות — בדוק שעמודות טלפון ושעה זוהו");
    setBusy(true);
    try {
      const batchId = crypto.randomUUID();

      const { data: inserted, error: insertErr } = await supabase
        .from("spa_staging")
        .insert(parsedRows.map((r) => ({ import_batch: batchId, ...r })))
        .select("id, phone, guest_name, treatment_time, treatment_type, raw_extras");

      if (insertErr) throw insertErr;

      // Fetch matching bookings — single query
      const phones = [...new Set(parsedRows.map((r) => r.phone))];
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, phone, arrival_date, guest_name")
        .in("phone", phones);

      const byPhone = {};
      for (const b of bookings ?? []) {
        if (!byPhone[b.phone]) byPhone[b.phone] = b;
      }

      // Parallel update of match_status in spa_staging
      await Promise.all(
        (inserted ?? []).map((s) =>
          supabase.from("spa_staging").update({
            matched_booking_id: byPhone[s.phone]?.id ?? null,
            match_status:       byPhone[s.phone] ? "matched" : "no_booking",
          }).eq("id", s.id)
        )
      );

      // Build display rows (no re-fetch needed — we have all the data)
      const display = (inserted ?? []).map((s) => ({
        ...s,
        is_suite:            (s.raw_extras ?? "").includes(SUITE_MARKER),
        matched_booking_id:  byPhone[s.phone]?.id ?? null,
        matched_guest_name:  byPhone[s.phone]?.guest_name ?? null,
        matched_arrival:     byPhone[s.phone]?.arrival_date ?? null,
        match_status:        byPhone[s.phone] ? "matched" : "no_booking",
        sync_status:         "pending",
      }));

      setStaged(display);
      setStep("review");
    } catch (err) {
      showToast("err", "שגיאה בייבוא: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Approve single row ──────────────────────────────────────────────────────
  const approveRow = async (row) => {
    setApproving((prev) => new Set([...prev, row.id]));
    try {
      if (row.matched_booking_id) {
        const { error } = await supabase.from("bookings").update({
          treatment_time: row.treatment_time,
          treatment_type: row.treatment_type,
        }).eq("id", row.matched_booking_id);
        if (error) throw error;
      }
      await supabase.from("spa_staging").update({
        sync_status: "synced",
        reviewed_at: new Date().toISOString(),
      }).eq("id", row.id);
      setStaged((prev) => prev.map((r) => (r.id === row.id ? { ...r, sync_status: "synced" } : r)));
    } catch (err) {
      showToast("err", "שגיאה: " + err.message);
    } finally {
      setApproving((prev) => { const s = new Set(prev); s.delete(row.id); return s; });
    }
  };

  // ── Reject single row ───────────────────────────────────────────────────────
  const rejectRow = async (row) => {
    await supabase.from("spa_staging").update({
      sync_status: "rejected",
      reviewed_at: new Date().toISOString(),
    }).eq("id", row.id);
    setStaged((prev) => prev.map((r) => (r.id === row.id ? { ...r, sync_status: "rejected" } : r)));
  };

  // ── Bulk delete selected rows ───────────────────────────────────────────────
  const deleteSelected = async () => {
    if (!selectedIds.size) return;
    setBusy(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("spa_staging").delete().in("id", ids);
      if (error) throw error;
      setStaged((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      showToast("ok", `🗑 ${ids.length} שורות נמחקו`);
    } catch (err) {
      showToast("err", "שגיאה במחיקה: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Approve ALL matched pending rows ────────────────────────────────────────
  const approveAllMatched = async () => {
    const pending = staged.filter((r) => r.match_status === "matched" && r.sync_status === "pending");
    if (!pending.length) return showToast("err", "אין שורות matched ממתינות");
    setBusy(true);
    try {
      const updates = pending.filter((r) => r.matched_booking_id).map((r) => ({
        id:             r.matched_booking_id,
        treatment_time: r.treatment_time,
        treatment_type: r.treatment_type,
      }));
      if (updates.length) {
        await supabase.from("bookings").upsert(updates, { onConflict: "id" });
      }
      const ids = pending.map((r) => r.id);
      await supabase.from("spa_staging").update({
        sync_status: "synced",
        reviewed_at: new Date().toISOString(),
      }).in("id", ids);
      setStaged((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, sync_status: "synced" } : r)));
      showToast("ok", `✅ סונכרנו ${updates.length} שעות טיפול ל-Bookings`);
    } catch (err) {
      showToast("err", "שגיאה: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const stats = {
    total:     staged.length,
    matched:   staged.filter((r) => r.match_status === "matched").length,
    noBooking: staged.filter((r) => r.match_status === "no_booking").length,
    synced:    staged.filter((r) => r.sync_status === "synced").length,
    pending:   staged.filter((r) => r.sync_status === "pending" && r.match_status === "matched").length,
  };

  // Select-all helpers — synced rows are excluded (nothing to delete there)
  const selectableIds  = staged.filter((r) => r.sync_status !== "synced").map((r) => r.id);
  const allSelected    = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected   = !allSelected && selectableIds.some((id) => selectedIds.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* ── STEP 1: Upload ── */}
      {step === "upload" && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); parseFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
              background: dragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
              borderRadius: 16, padding: "40px 20px", textAlign: "center", cursor: "pointer",
              transition: "all 0.2s", marginBottom: 20,
            }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>💆</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
              {fileName || "גרור קובץ לוח ספא לכאן או לחץ לבחירה"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Excel מ-EZGO — עמודות: טלפון, שעת טיפול, סוג טיפול, שם אורח, חבילה
            </div>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => parseFile(e.target.files?.[0])} />
          </div>

          {rawRows.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div className="card-title">תצוגה מקדימה — {parsedRows.length} שורות תקינות מתוך {rawRows.length}</div>
              </div>
              <div style={{ padding: 16 }}>
                {/* Column map status */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {Object.entries(SPA_ALIASES).map(([col]) => (
                    <span key={col} style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                      background: colMap[col] ? "rgba(26,122,74,0.12)" : "rgba(192,57,43,0.1)",
                      color:      colMap[col] ? "#1A7A4A" : "#C0392B",
                      border:     `1px solid ${colMap[col] ? "#1A7A4A" : "#C0392B"}`,
                    }}>
                      {colMap[col] ? "✓" : "✕"} {col}
                    </span>
                  ))}
                </div>

                {!colMap.phone && (
                  <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", color: "#C0392B",
                    borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
                    ⚠️ עמודת טלפון לא זוהתה — ייבוא לא יתאפשר
                  </div>
                )}
                {!colMap.treatment_time && (
                  <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", color: "#C0392B",
                    borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
                    ⚠️ עמודת שעת טיפול לא זוהתה — ייבוא לא יתאפשר
                  </div>
                )}

                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ minWidth: 540 }}>
                    <thead>
                      <tr>
                        <th>שם אורח</th>
                        <th>טלפון</th>
                        <th>שעת טיפול</th>
                        <th>סוג טיפול</th>
                        <th>חבילה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 13 }}>{r.guest_name || "—"}</td>
                          <td style={{ fontSize: 12, fontFamily: "monospace" }}>{r.phone || "—"}</td>
                          <td style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-dark)" }}>{r.treatment_time || "—"}</td>
                          <td style={{ fontSize: 13 }}>{r.treatment_type || "—"}</td>
                          <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(r.raw_extras ?? "").includes(SUITE_MARKER)
                              ? <span style={{ color: "var(--gold-dark)", fontWeight: 700 }}>⭐ סוויטה</span>
                              : r.raw_extras || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button className="btn btn-primary"
                    disabled={busy || !parsedRows.length || !colMap.phone || !colMap.treatment_time}
                    onClick={handleStage}
                    style={{ minWidth: 200, fontSize: 15, opacity: busy ? 0.6 : 1 }}>
                    {busy ? "מעבד..." : `📤 ייבא ${parsedRows.length} שורות לסקירה`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── STEP 2: Review ── */}
      {step === "review" && (
        <div>
          {/* Stats bar */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              { label: "סה״כ",       val: stats.total,     color: "var(--black)" },
              { label: "✓ נמצאו",    val: stats.matched,   color: "#1A7A4A" },
              { label: "⚠ לא ידוע", val: stats.noBooking, color: "#E67E22" },
              { label: "✅ סונכרנו", val: stats.synced,    color: "var(--gold-dark)" },
            ].map((s) => (
              <div key={s.label} style={{
                padding: "8px 16px", borderRadius: 20, background: "var(--card-bg)",
                border: "1px solid var(--border)", fontSize: 13, fontWeight: 700, color: s.color,
              }}>
                {s.label}: {s.val}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <button className="btn btn-primary"
              disabled={busy || stats.pending === 0}
              onClick={approveAllMatched}
              style={{ opacity: busy ? 0.6 : 1 }}>
              {busy ? "מסנכרן..." : `✅ אשר הכל matched (${stats.pending})`}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={busy}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "1px solid #C0392B",
                  background: "#C0392B", color: "#fff", fontSize: 14, fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
                  fontFamily: "Heebo, sans-serif",
                }}>
                🗑 מחק מסומנים ({selectedIds.size})
              </button>
            )}
            <button className="btn" onClick={() => { setStep("upload"); setRawRows([]); setHeaders([]); setFileName(""); setStaged([]); setSelectedIds(new Set()); }}
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              ← העלה קובץ חדש
            </button>
          </div>

          {/* Review table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">סקירת מנהל — {staged.length} רשומות</div>
            </div>
            <div style={{ padding: 0, overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        style={{ cursor: "pointer", width: 15, height: 15 }}
                        title="בחר הכל"
                      />
                    </th>
                    <th>שם אורח</th>
                    <th>טלפון</th>
                    <th>שעת טיפול</th>
                    <th>סוג טיפול</th>
                    <th>סוויטה</th>
                    <th>התאמה</th>
                    <th>פעולה</th>
                  </tr>
                </thead>
                <tbody>
                  {staged.map((row) => {
                    const isMatched   = row.match_status === "matched";
                    const isSynced    = row.sync_status === "synced";
                    const isRejected  = row.sync_status === "rejected";
                    const isApproving = approving.has(row.id);
                    const isSelected  = selectedIds.has(row.id);

                    const rowBg = isSelected  ? "rgba(192,57,43,0.06)"
                                : isSynced    ? "rgba(201,169,110,0.08)"
                                : isRejected  ? "rgba(192,57,43,0.04)"
                                : isMatched   ? "rgba(26,122,74,0.07)"
                                :               "rgba(230,126,34,0.07)";
                    const borderColor = isSelected  ? "rgba(192,57,43,0.5)"
                                      : isSynced    ? "rgba(201,169,110,0.4)"
                                      : isRejected  ? "rgba(192,57,43,0.2)"
                                      : isMatched   ? "rgba(26,122,74,0.25)"
                                      :               "rgba(230,126,34,0.3)";

                    return (
                      <tr key={row.id} style={{ background: rowBg, borderRight: `3px solid ${borderColor}` }}>
                        <td style={{ textAlign: "center", padding: "9px 6px" }}>
                          {!isSynced && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRow(row.id)}
                              style={{ cursor: "pointer", width: 15, height: 15 }}
                            />
                          )}
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {row.guest_name || "—"}
                          {row.matched_guest_name && row.matched_guest_name !== row.guest_name && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>→ {row.matched_guest_name}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 12, fontFamily: "monospace" }}>{row.phone}</td>
                        <td style={{ fontSize: 15, fontWeight: 700, color: "var(--gold-dark)" }}>{row.treatment_time}</td>
                        <td style={{ fontSize: 12 }}>{row.treatment_type || "—"}</td>
                        <td style={{ textAlign: "center" }}>
                          {row.is_suite ? <span style={{ fontSize: 16 }}>⭐</span> : "—"}
                        </td>
                        <td>
                          <span style={{
                            padding: "3px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
                            background: isSynced   ? "rgba(201,169,110,0.2)"
                                      : isRejected ? "rgba(192,57,43,0.1)"
                                      : isMatched  ? "rgba(26,122,74,0.15)"
                                      :              "rgba(230,126,34,0.15)",
                            color: isSynced   ? "var(--gold-dark)"
                                 : isRejected ? "#C0392B"
                                 : isMatched  ? "#1A7A4A"
                                 :              "#E67E22",
                          }}>
                            {isSynced ? "✅ סונכרן" : isRejected ? "✕ נדחה" : STATUS_LABEL[row.match_status]}
                          </span>
                          {row.matched_arrival && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{row.matched_arrival}</div>
                          )}
                        </td>
                        <td>
                          {!isSynced && !isRejected && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => approveRow(row)}
                                disabled={isApproving}
                                style={{
                                  padding: "4px 12px", borderRadius: 8, border: "1px solid #1A7A4A",
                                  background: "#1A7A4A", color: "#fff", fontSize: 12, fontWeight: 700,
                                  cursor: isApproving ? "not-allowed" : "pointer", opacity: isApproving ? 0.6 : 1,
                                  fontFamily: "Heebo, sans-serif",
                                }}>
                                {isApproving ? "..." : "✓ אשר"}
                              </button>
                              <button
                                onClick={() => rejectRow(row)}
                                disabled={isApproving}
                                style={{
                                  padding: "4px 10px", borderRadius: 8, border: "1px solid #C0392B",
                                  background: "transparent", color: "#C0392B", fontSize: 12, fontWeight: 700,
                                  cursor: "pointer", fontFamily: "Heebo, sans-serif",
                                }}>
                                ✕
                              </button>
                            </div>
                          )}
                          {isSynced && (
                            <span style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 700 }}>שעה עודכנה</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
