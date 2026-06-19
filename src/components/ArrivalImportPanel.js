// src/components/ArrivalImportPanel.js
// Dual-upload panel for daily arrival import.
// Doc 2 (Suite CSV) → per-room individual profiles via ezgoParser.js
// Doc 1 (Comprehensive Daily Report Excel) → spa_time enrichment
// Merge: enrichProfilesFromExcel joins by order_number → 26 individual profiles for group bookings
// Sync:  sync_suite_arrivals RPC (guests + suite_rooms + bookings) + separate spa_time UPDATE

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";
import {
  aggregateGuestProfiles,
  profilesToArray,
  enrichProfilesFromExcel,
} from "../utils/ezgoParser";

// ── Date / phone helpers (pure, no side effects) ──────────────────────────────

const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

function _parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 40000) {
    const dt = new Date(Math.round((serial - 25569) * 86_400_000));
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  return null;
}

function _addNights(arrival_date, nights) {
  if (!arrival_date || !nights) return null;
  const d = new Date(arrival_date);
  d.setDate(d.getDate() + parseInt(nights));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _sanitizeE164(raw) {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? c : null;
}

// ── Comprehensive Daily Report Parser (Doc 1) ─────────────────────────────────
// Mirrors parseComprehensiveReport in DataUpload.js (pure function, safe to duplicate).
// Produces: [{ order_number, guest_name, phone, arrival_date, spa_time, treatment_count }]

const _SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;

function _extractExtras(block, raw) {
  const clean = String(raw).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const m = clean.match(/^(\d+)\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return;
  const count = parseInt(m[1]);
  const time  = m[2].padStart(2, "0") + ":" + m[3];
  block.treatment_count += count;
  if (!block.spa_time || time < block.spa_time) block.spa_time = time;
}

function parseComprehensiveReport(rows) {
  let arrivalDate = null;
  let current     = null;
  const blocks    = [];

  for (const row of rows) {
    const [c0, c1, c2] = Array.isArray(row) ? row : [];

    if (!arrivalDate && typeof c0 === "number" && c0 > 40000) {
      arrivalDate = _parseDate(c0);
    }

    if (c1 && typeof c1 === "string" && /^\d+:/.test(c1)) {
      if (current) blocks.push(current);
      const orderMatch = c1.match(/^(\d+):/);
      const phoneMatch = c1.match(/\s+-\s+([+\d][\d\s\-+]{7,})\s*$/);
      const phone      = phoneMatch ? _sanitizeE164(phoneMatch[1]) : null;
      const afterId    = c1.replace(/^\d+:\s*/, "");
      const nameRaw    = phoneMatch
        ? afterId.slice(0, afterId.lastIndexOf(phoneMatch[0])).trim()
        : afterId.trim();
      current = {
        order_number:    orderMatch ? orderMatch[1] : null,
        guest_name:      nameRaw.replace(_SOURCE_RE, "").trim() || null,
        phone,
        arrival_date:    arrivalDate,
        spa_time:        null,
        treatment_count: 0,
      };
      if (c2) _extractExtras(current, c2);
      continue;
    }
    if (!current) continue;
    if (c2) _extractExtras(current, c2);
  }
  if (current) blocks.push(current);

  const byPhone = {};
  for (const b of blocks) {
    if (!b.phone) continue;
    if (!byPhone[b.phone]) { byPhone[b.phone] = { ...b }; }
    else {
      const ex = byPhone[b.phone];
      ex.treatment_count += b.treatment_count;
      if (b.spa_time && (!ex.spa_time || b.spa_time < ex.spa_time)) ex.spa_time = b.spa_time;
    }
  }
  return Object.values(byPhone);
}

// ── Profile Map cloner ────────────────────────────────────────────────────────
// Prevents enrichProfilesFromExcel from mutating the stored state Map.

function _cloneProfileMap(map) {
  const clone = new Map();
  for (const [k, v] of map) {
    clone.set(k, { ...v, rooms: [...v.rooms], orderNumbers: new Set(v.orderNumbers) });
  }
  return clone;
}

// ── Date fallback from filename ("18.6.26 סוויטות.csv" → "2026-06-18") ────────

function _dateFromFilename(name) {
  const dm = name.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})/);
  if (!dm) return null;
  const y = dm[3].length === 2 ? `20${dm[3]}` : dm[3];
  return `${y}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
}

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ label, hint, loaded, fileName, onFile, inputRef }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={e  => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${loaded ? "var(--gold)" : dragging ? "var(--gold-dark)" : "var(--border)"}`,
        background: loaded ? "rgba(201,169,110,0.07)" : dragging ? "rgba(201,169,110,0.1)" : "var(--ivory)",
        borderRadius: 14, padding: "22px 14px", textAlign: "center",
        cursor: "pointer", transition: "all 0.18s",
      }}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 26, marginBottom: 6 }}>{loaded ? "✅" : "📂"}</div>
      <div style={{ fontSize: 13, fontWeight: 700,
        color: loaded ? "var(--gold-dark)" : "var(--black)", marginBottom: 3 }}>
        {label}
      </div>
      {fileName
        ? <div style={{ fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>{fileName}</div>
        : <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</div>
      }
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArrivalImportPanel() {
  const [open,     setOpen]     = useState(false);
  const [doc2Map,  setDoc2Map]  = useState(null);   // Map<phone, profile> — Suite CSV
  const [doc1Rec,  setDoc1Rec]  = useState(null);   // array of spa records — Daily Report
  const [doc2Name, setDoc2Name] = useState("");
  const [doc1Name, setDoc1Name] = useState("");
  const [merged,   setMerged]   = useState(null);   // final array shown in preview
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [toast,    setToast]    = useState(null);
  const doc2Ref = useRef();
  const doc1Ref = useRef();

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  // Recompute merged profiles whenever either document changes
  useEffect(() => {
    if (!doc2Map) { setMerged(null); return; }
    const mapCopy = _cloneProfileMap(doc2Map);
    if (doc1Rec && doc1Rec.length > 0) {
      enrichProfilesFromExcel(mapCopy, doc1Rec);
    }
    setMerged(profilesToArray(mapCopy));
  }, [doc2Map, doc1Rec]);

  // ── Parse Doc 2: Suite CSV ──────────────────────────────────────────────
  const handleDoc2 = useCallback(async (file) => {
    if (!file) return;
    setDoc2Name(file.name);
    setResult(null);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array", raw: false });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const profileMap = aggregateGuestProfiles(rows, _dateFromFilename(file.name));
      if (!profileMap.size) {
        showToast("err", "לא נמצאו פרופילים — בדוק שהקובץ הוא ייצוא EZGO Suites CSV");
        return;
      }
      setDoc2Map(profileMap);
    } catch (err) {
      showToast("err", "שגיאה בקריאת Suite CSV: " + err.message);
    }
  }, []);

  // ── Parse Doc 1: Comprehensive Daily Report ─────────────────────────────
  const handleDoc1 = useCallback(async (file) => {
    if (!file) return;
    setDoc1Name(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
      const records = parseComprehensiveReport(rows);
      if (!records.length) {
        showToast("err", "לא נמצאו הזמנות בדוח — בדוק פורמט");
        return;
      }
      setDoc1Rec(records);
    } catch (err) {
      showToast("err", "שגיאה בקריאת הדוח: " + err.message);
    }
  }, []);

  // ── DB Sync ──────────────────────────────────────────────────────────────
  const handleSync = async () => {
    if (!supabase || !merged) return;
    setSyncing(true);
    setResult(null);
    try {
      // Build RPC payload — same shape as DataUpload.js handleEzgoSync
      const profiles = merged
        .filter(g => g.guestPhone)
        .map(g => {
          const nights = (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0);
          return {
            guestPhone:      g.guestPhone,
            guestName:       g.guestName ?? "",
            arrivalDate:     g.arrivalDate ?? null,
            departureDate:   _addNights(g.arrivalDate, nights),
            orderNumber:     [...(g.orderNumbers ?? [])][0] ?? null,
            hasSuite:        !!g.hasSuite,
            treatment_count: g.treatment_count ?? 0,
            nights,
          };
        });

      const rooms = merged
        .flatMap(g =>
          (g.rooms ?? []).map(r => ({
            resLineId:    r.resLineId,
            orderNumber:  r.orderNumber,
            roomName:     r.roomName,
            suiteType:    r.suiteType,
            guestName:    g.guestName ?? "",
            guestPhone:   g.guestPhone ?? null,
            coordPhone:   g.coordPhone ?? null,
            phoneSource:  g.phoneSource,
            adults:       r.adults,
            nights:       r.nights,
            arrivalDate:  g.arrivalDate ?? null,
            checkinTime:  r.checkinTime ?? null,
            checkoutTime: r.checkoutTime ?? null,
            isDayGuest:   !!r.isDayGuest,
          }))
        )
        .filter(r => r.resLineId && r.orderNumber);

      // Step 1: RPC — atomic guests + suite_rooms + bookings write
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc("sync_suite_arrivals", { payload: { profiles, rooms } });
      if (rpcErr) throw new Error("sync_suite_arrivals: " + rpcErr.message);

      // Step 2: Inject spa_time — RPC intentionally does not overwrite this field
      const spaProfiles = merged.filter(g => g.guestPhone && g.spa_time);
      for (const g of spaProfiles) {
        const patch = { spa_time: g.spa_time };
        if (g.treatment_count) patch.treatment_count = g.treatment_count;
        await supabase.from("guests").update(patch).eq("phone", g.guestPhone);
      }

      setResult({
        total:  rpcData.guests,
        rooms:  rpcData.rooms,
        suites: merged.filter(g => g.hasSuite).length,
        days:   merged.filter(g => g.hasDayBooking && !g.hasSuite).length,
        spa:    spaProfiles.length,
      });
    } catch (err) {
      showToast("err", "שגיאת סנכרון: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const reset = () => {
    setDoc2Map(null); setDoc1Rec(null);
    setDoc2Name(""); setDoc1Name("");
    setMerged(null); setResult(null);
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = merged ? {
    total:      merged.length,
    suites:     merged.filter(g => g.hasSuite).length,
    days:       merged.filter(g => g.hasDayBooking && !g.hasSuite).length,
    withSpa:    merged.filter(g => g.spa_time).length,
    individual: merged.filter(g => g.phoneSource === "individual").length,
  } : null;

  return (
    <div style={{ marginBottom: 20 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 22px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* Collapsible header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 18px", cursor: "pointer", userSelect: "none",
          background: "linear-gradient(135deg,rgba(201,169,110,0.15),rgba(201,169,110,0.04))",
          border: "1px solid var(--gold)",
          borderRadius: open ? "12px 12px 0 0" : 12,
          transition: "border-radius 0.15s",
        }}
      >
        <span style={{ fontSize: 18 }}>📅</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-dark)", flex: 1 }}>
          ייבוא הגעות יומי
        </span>
        {stats && (
          <span style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600 }}>
            {stats.total} פרופילים · {stats.individual} פרטיים
          </span>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          border: "1px solid var(--gold)", borderTop: "none",
          borderRadius: "0 0 12px 12px", padding: "18px 18px 20px",
          background: "var(--card-bg)",
        }}>

          {/* Info banner */}
          <div style={{
            background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.3)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 14,
            fontSize: 12, color: "var(--gold-dark)", lineHeight: 1.7,
          }}>
            <strong>שלב 1:</strong> העלה דוח כניסות EZGO (Doc 2) — חובה<br />
            <strong>שלב 2:</strong> העלה דוח יומי מקיף (Doc 1) — להזרקת שעות ספא (אופציונלי)<br />
            המערכת מחלצת <strong>טלפון אישי</strong> מעמודת ההערה ויוצרת פרופיל נפרד לכל אורח.
          </div>

          {/* Two drop zones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <DropZone
              label="📋 דוח כניסות EZGO"
              hint="CSV מ-EZGO — חדרים, שמות, טלפונים (חובה)"
              loaded={!!doc2Map}
              fileName={doc2Name}
              onFile={handleDoc2}
              inputRef={doc2Ref}
            />
            <DropZone
              label="📊 דוח יומי מקיף"
              hint="Excel — שעות ספא לפי הזמנה (אופציונלי)"
              loaded={!!doc1Rec}
              fileName={doc1Name}
              onFile={handleDoc1}
              inputRef={doc1Ref}
            />
          </div>

          {/* Stats bar */}
          {stats && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {[
                { label: "פרופילים",    val: stats.total,      c: "#7c3aed", bg: "#f3f0ff" },
                { label: "סוויטות",     val: stats.suites,     c: "#b45309", bg: "#fef3c7" },
                { label: "בילוי יומי",  val: stats.days,       c: "#0e7490", bg: "#ecfeff" },
                { label: "עם ספא",      val: stats.withSpa,    c: "#16a34a", bg: "#f0fdf4" },
                { label: "טלפון פרטי",  val: stats.individual, c: "#dc2626", bg: "#fef2f2" },
              ].map(({ label, val, c, bg }) => (
                <div key={label} style={{
                  background: bg, borderRadius: 8, padding: "6px 12px",
                  border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 5,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Preview table */}
          {merged && merged.length > 0 && !result && (
            <div style={{
              border: "1px solid var(--border)", borderRadius: 10,
              overflow: "hidden", marginBottom: 14,
            }}>
              <div style={{ overflowX: "auto", maxHeight: 340 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead>
                    <tr style={{ background: "var(--ivory)" }}>
                      {["שם אורח", "טלפון", "מקור", "חדר", "שעת ספא", "הגעה"].map(h => (
                        <th key={h} style={{
                          padding: "8px 12px", fontSize: 11, fontWeight: 700,
                          color: "var(--text-muted)", textAlign: "right",
                          borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {merged.slice(0, 100).map((g, i) => (
                      <tr key={i} style={{
                        borderBottom: "1px solid var(--border)",
                        background: g.phoneSource === "individual"
                          ? "rgba(22,163,74,0.03)" : i % 2 === 0 ? "#fff" : "var(--ivory)",
                      }}>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
                          {g.guestName || "—"}
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)",
                          direction: "ltr", textAlign: "right" }}>
                          {g.guestPhone ? "0" + String(g.guestPhone).slice(4) : "—"}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <span style={{
                            display: "inline-block", padding: "2px 7px", borderRadius: 10,
                            fontSize: 10, fontWeight: 700,
                            background: g.phoneSource === "individual" ? "#DCFCE7" : "#F1F5F9",
                            color:      g.phoneSource === "individual" ? "#15803D"  : "#64748B",
                          }}>
                            {g.phoneSource === "individual" ? "פרטי" : "קואורד׳"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--gold-dark)", fontWeight: 600 }}>
                          {g.rooms.length > 1
                            ? `${g.rooms.length} חדרים`
                            : g.rooms[0]?.roomName
                              ? `${(g.rooms[0].suiteType ?? "").replace(/^סוויטת\s*/u, "").split(" ")[0] ?? ""} ${g.rooms[0].roomName}`.trim()
                              : "—"
                          }
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800,
                          color: g.spa_time ? "var(--gold-dark)" : "var(--text-muted)" }}>
                          {g.spa_time ?? "—"}
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 12 }}>
                          {g.arrivalDate ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {merged.length > 100 && (
                <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                  ועוד {merged.length - 100} רשומות...
                </div>
              )}
            </div>
          )}

          {/* Sync + reset buttons */}
          {doc2Map && !result && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleSync}
                disabled={syncing || !merged}
                style={{
                  flex: 1, padding: "13px", borderRadius: 10, border: "none",
                  background: syncing ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: syncing ? "var(--text-muted)" : "#0F0F0F",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  cursor: syncing ? "not-allowed" : "pointer", transition: "all 0.15s",
                }}>
                {syncing ? "⏳ מסנכרן..." : `⚡ ייבא ${merged?.length ?? 0} פרופילים ל-DB`}
              </button>
              <button onClick={reset} style={{
                padding: "13px 16px", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--card-bg)",
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
                fontSize: 13, color: "var(--text-muted)",
              }}>
                ✕ נקה
              </button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              background: "#d1fae5", border: "1px solid #6ee7b7",
              borderRadius: 12, padding: "20px",
            }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#065f46", marginBottom: 6 }}>
                {result.total} אורחים יובאו בהצלחה
              </div>
              <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.9 }}>
                🏨 {result.suites} סוויטות ·
                ☀️ {result.days} בילוי יומי ·
                🛏️ {result.rooms} חדרים
                {result.spa > 0 && <> · 💆 {result.spa} עם שעת ספא</>}
              </div>
              <button onClick={reset} style={{
                marginTop: 16, padding: "8px 18px", borderRadius: 8,
                border: "1px solid #6ee7b7", background: "transparent",
                color: "#065f46", cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              }}>
                ← ייבוא נוסף
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
