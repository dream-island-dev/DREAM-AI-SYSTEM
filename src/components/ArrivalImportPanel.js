// src/components/ArrivalImportPanel.js
// Unified Import Hub — the SOLE import surface in the app (per session 7 consolidation).
// Lives only inside TaskBoard. Two profiles:
//
//   "suites" — Doc 2 (Suite CSV) → aggregateGuestProfiles → editable grid (suite
//              dropdown sourced from SUITE_REGISTRY) → sync_suite_arrivals RPC
//              (guests + suite_rooms + bookings, with guests.room denormalized).
//              Doc 1 (Daily Report Excel, optional) → parseComprehensiveReport →
//              merges spa_time into the same grid before sync.
//   "shifts" — any Excel → editable grid → export back to .xlsx (no DB write).
//
// SpaStagingPanel remains a separate, standalone tool — it solves a different
// problem (triaging an external email/PDF automation against existing bookings)
// and is intentionally NOT folded in here.

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { EditableGrid, BulkEditBar, exportToExcel } from "./EditableGrid";
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import {
  aggregateGuestProfiles,
  profilesToArray,
  enrichProfilesFromExcel,
} from "../utils/ezgoParser";

// ── Date / phone helpers ──────────────────────────────────────────────────────

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

// ── Room dropdown options — SUITE_REGISTRY + exactly two day packages ───────
// Single source for every "assign a room" UI in the app (this panel + GuestsPage).
const ROOM_OPTIONS = [
  { value: "", label: "— ללא חדר —" },
  { value: "Premium Day 1", label: "⭐ חבילת פרימיום בילוי יומי 1" },
  { value: "Premium Day 2", label: "⭐ חבילת פרימיום בילוי יומי 2" },
  ...SUITE_REGISTRY.map(s => ({ value: s, label: s })),
];

// Best-effort match: ezgoParser extracts a bare room number ("8"); find the
// SUITE_REGISTRY entry that ends with it so the grid can prefill a guess.
// Left blank (forcing a manual pick) when ambiguous — Fail Visible over guessing wrong.
function _bestGuessSuite(roomName) {
  if (!roomName) return "";
  const num = String(roomName).match(/\d+/)?.[0];
  if (!num) return "";
  const matches = SUITE_REGISTRY.filter(s => s.endsWith(" " + num));
  return matches.length === 1 ? matches[0] : "";
}

// ── Comprehensive Daily Report Parser (Doc 1) ─────────────────────────────────
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

  // Deduplicate by phone — accumulate treatment counts
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

// ── Shift-schedule Excel parser (ported from DataHub) ────────────────────────
async function parseShiftFile(arrayBuf) {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(arrayBuf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map(row => ({ _id: crypto.randomUUID(), ...row }));
}

// ── Suite-CSV profiles → flat grid rows ──────────────────────────────────────
// One row per guest profile. Multi-room (group) profiles show a read-only
// "N rooms" count instead of a single editable room — picking a value there
// still works and applies uniformly to that profile's rooms on sync.
function _profilesToGridRows(merged) {
  return merged.map((g, i) => {
    const singleRoom = (g.rooms ?? []).length === 1 ? g.rooms[0] : null;
    const isDay       = !!g.isDayGuest || !!singleRoom?.isDayGuest;
    const guess       = !isDay && singleRoom ? _bestGuessSuite(singleRoom.roomName) : "";
    return {
      _id:          g.guestPhone || `row_${i}`,
      _profileIdx:  i,
      guestName:    g.guestName ?? "",
      guestPhone:   g.guestPhone ?? "",
      phoneSource:  g.phoneSource === "individual" ? "פרטי" : "קואורד׳",
      roomCount:    (g.rooms ?? []).length > 1 ? `${g.rooms.length} חדרים` : "",
      room:         (g.rooms ?? []).length > 1 ? "" : (isDay ? (singleRoom?.isDayGuest ? guess : "") : guess),
      spa_time:     g.spa_time ?? "",
      arrivalDate:  g.arrivalDate ?? "",
    };
  });
}

const SUITES_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",   editable: true,  w: 150 },
  { id: "guestPhone",  label: "טלפון",      editable: false, w: 120 },
  { id: "phoneSource", label: "מקור",       editable: false, w: 80  },
  { id: "roomCount",   label: "קבוצה",      editable: false, w: 70  },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true, w: 190, gold: true, options: ROOM_OPTIONS },
  { id: "spa_time",    label: "שעת ספא",    editable: true,  w: 90  },
  { id: "arrivalDate", label: "הגעה",       editable: false, w: 100 },
];

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ label, hint, loaded, fileName, onFile, inputRef, optional }) {
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
        borderRadius: 14, padding: "18px 12px", textAlign: "center",
        cursor: "pointer", transition: "all 0.18s", position: "relative",
      }}
    >
      {optional && !loaded && (
        <span style={{
          position: "absolute", top: 7, left: 9, fontSize: 9, fontWeight: 700,
          background: "var(--border)", color: "var(--text-muted)",
          padding: "1px 6px", borderRadius: 6,
        }}>אופציונלי</span>
      )}
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 24, marginBottom: 5 }}>{loaded ? "✅" : "📂"}</div>
      <div style={{ fontSize: 12, fontWeight: 700,
        color: loaded ? "var(--gold-dark)" : "var(--black)", marginBottom: 3 }}>
        {label}
      </div>
      {fileName
        ? <div style={{ fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>{fileName}</div>
        : <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{hint}</div>
      }
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArrivalImportPanel() {
  const [open,     setOpen]     = useState(false);
  const [tab,      setTab]      = useState("suites"); // "suites" | "shifts"

  // Suites profile state
  const [doc2Map,  setDoc2Map]  = useState(null);   // Map<key, profile> from Suite CSV
  const [doc1Rec,  setDoc1Rec]  = useState(null);   // [] from Daily Report Excel
  const [doc2Name, setDoc2Name] = useState("");
  const [doc1Name, setDoc1Name] = useState("");
  const [merged,   setMerged]   = useState(null);   // enriched profiles array (doc2 + doc1 join)
  const [gridRows, setGridRows] = useState([]);      // editable grid rows derived from merged
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [toast,    setToast]    = useState(null);
  const doc2Ref = useRef();
  const doc1Ref = useRef();

  // Shifts profile state
  const [shiftRows,    setShiftRows]    = useState([]);
  const [shiftCols,    setShiftCols]    = useState([]);
  const [shiftSelected, setShiftSelected] = useState(new Set());
  const [shiftFileName, setShiftFileName] = useState("");
  const shiftRef = useRef();

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  // Derived flags
  const hasDoc2 = !!doc2Map;
  const hasDoc1 = !!(doc1Rec && doc1Rec.length > 0);
  const canSync = hasDoc2 || hasDoc1;

  // Recompute merged whenever Suite CSV or Daily Report changes
  useEffect(() => {
    if (!doc2Map) { setMerged(null); return; }
    const mapCopy = _cloneProfileMap(doc2Map);
    if (doc1Rec && doc1Rec.length > 0) {
      enrichProfilesFromExcel(mapCopy, doc1Rec);
    }
    setMerged(profilesToArray(mapCopy));
  }, [doc2Map, doc1Rec]);

  // Recompute grid rows whenever merged changes (fresh parse — discards manual edits)
  useEffect(() => {
    if (!merged) { setGridRows([]); return; }
    setGridRows(_profilesToGridRows(merged));
  }, [merged]);

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

  // ── Parse Doc 1: Comprehensive Daily Report Excel ───────────────────────
  const handleDoc1 = useCallback(async (file) => {
    if (!file) return;
    setDoc1Name(file.name);
    setResult(null);
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

  // ── Bulk replace (suites grid) ───────────────────────────────────────────
  const handleGridReplace = (colId, search, replacement) => {
    setGridRows(prev => prev.map(r => {
      if (!selectedIds.has(r._id)) return r;
      const current = String(r[colId] ?? "");
      const updated = search
        ? current.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement)
        : replacement;
      return { ...r, [colId]: updated };
    }));
  };

  // ── DB Sync — 2 independent paths ────────────────────────────────────────
  const handleSync = async () => {
    if (!supabase || !canSync) return;
    setSyncing(true);
    setResult(null);
    try {

      // ── PATH A: Suite CSV loaded (rooms + guests + bookings) ─────────────
      if (hasDoc2 && merged) {
        const profiles = merged
          .filter(g => g.guestPhone)
          .map((g, i) => {
            const edited = gridRows[i] ?? {};
            const nights = (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0);
            return {
              guestPhone:      g.guestPhone,
              guestName:       edited.guestName ?? g.guestName ?? "",
              arrivalDate:     g.arrivalDate ?? null,
              departureDate:   _addNights(g.arrivalDate, nights),
              orderNumber:     [...(g.orderNumbers ?? [])][0] ?? null,
              hasSuite:        !!g.hasSuite,
              treatment_count: g.treatment_count ?? 0,
              nights,
            };
          });

        const rooms = merged
          .flatMap((g, i) => {
            const edited      = gridRows[i] ?? {};
            const roomOverride = edited.room || "";
            return (g.rooms ?? []).map(r => ({
              resLineId:    r.resLineId,
              orderNumber:  r.orderNumber,
              roomName:     r.roomName,
              suiteType:    r.suiteType,
              // Full SUITE_REGISTRY-style display string, used ONLY for the
              // guests.room denormalization — never overwrites room_name/suite_type.
              roomDisplay:  roomOverride || _bestGuessSuite(r.roomName) || null,
              guestName:    edited.guestName ?? g.guestName ?? "",
              guestPhone:   g.guestPhone ?? null,
              coordPhone:   g.coordPhone ?? null,
              phoneSource:  g.phoneSource,
              adults:       r.adults,
              nights:       r.nights,
              arrivalDate:  g.arrivalDate ?? null,
              checkinTime:  r.checkinTime ?? null,
              checkoutTime: r.checkoutTime ?? null,
              isDayGuest:   !!r.isDayGuest,
            }));
          })
          .filter(r => r.resLineId && r.orderNumber);

        const { data: rpcData, error: rpcErr } = await supabase
          .rpc("sync_suite_arrivals", { payload: { profiles, rooms } });
        if (rpcErr) throw new Error("sync_suite_arrivals: " + rpcErr.message);

        // Inject spa_time where Doc 1 enrichment (or manual grid edit) provided it
        for (let i = 0; i < merged.length; i++) {
          const g = merged[i];
          const edited  = gridRows[i] ?? {};
          const spaTime = edited.spa_time || g.spa_time;
          if (g.guestPhone && spaTime) {
            await supabase.from("guests")
              .update({ spa_time: spaTime, treatment_count: g.treatment_count ?? 0 })
              .eq("phone", g.guestPhone);
          }
        }

        setResult({
          mode:   "suites",
          total:  rpcData?.guests ?? profiles.length,
          rooms:  rpcData?.rooms  ?? rooms.length,
          suites: merged.filter(g => g.hasSuite).length,
          days:   merged.filter(g => g.hasDayBooking && !g.hasSuite).length,
          spa:    gridRows.filter(r => r.spa_time).length,
        });

      // ── PATH B: Daily Report only — upsert guests ────────────────────────
      // If guest exists → update spa fields only (never touch status/needs_callback)
      // If guest is new → INSERT full profile so they appear in guest management
      } else if (!hasDoc2 && hasDoc1) {
        const allPhones = doc1Rec.filter(r => r.phone).map(r => r.phone);
        let updated = 0, created = 0, skipped = 0;

        if (allPhones.length > 0) {
          const { data: existingRows } = await supabase
            .from("guests").select("phone").in("phone", allPhones);
          const existingPhones = new Set((existingRows ?? []).map(g => g.phone));

          for (const rec of doc1Rec) {
            if (!rec.phone) { skipped++; continue; }

            if (existingPhones.has(rec.phone)) {
              const patch = {};
              if (rec.spa_time)        patch.spa_time        = rec.spa_time;
              if (rec.treatment_count) patch.treatment_count = rec.treatment_count;
              if (rec.order_number)    patch.order_number    = rec.order_number;
              if (rec.arrival_date)    patch.arrival_date    = rec.arrival_date;
              const { error } = await supabase.from("guests").update(patch).eq("phone", rec.phone);
              if (!error) updated++; else skipped++;
            } else {
              const { error } = await supabase.from("guests").insert({
                phone:           rec.phone,
                name:            rec.guest_name ?? null,
                spa_time:        rec.spa_time   ?? null,
                treatment_count: rec.treatment_count ?? 0,
                order_number:    rec.order_number   ?? null,
                arrival_date:    rec.arrival_date   ?? null,
                status:          "pending",
              });
              if (!error) created++; else skipped++;
            }
          }
        } else {
          skipped = doc1Rec.length;
        }
        setResult({ mode: "spa", updated, created, skipped });
      }

    } catch (err) {
      showToast("err", "שגיאת סנכרון: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const reset = () => {
    setDoc2Map(null); setDoc1Rec(null);
    setDoc2Name(""); setDoc1Name("");
    setMerged(null); setGridRows([]); setSelectedIds(new Set()); setResult(null);
  };

  // ── Shifts profile handlers ──────────────────────────────────────────────
  const handleShiftFile = useCallback(async (file) => {
    if (!file) return;
    setShiftFileName(file.name);
    try {
      const buf    = await file.arrayBuffer();
      const parsed = await parseShiftFile(buf);
      if (!parsed.length) { showToast("err", "הקובץ ריק"); return; }
      const keys = Object.keys(parsed[0]).filter(k => k !== "_id");
      setShiftCols(keys.map(k => ({ id: k, label: String(k), editable: true, w: 120 })));
      setShiftRows(parsed);
    } catch (err) {
      showToast("err", "שגיאה בניתוח: " + err.message);
    }
  }, []);

  const handleShiftReplace = (colId, search, replacement) => {
    setShiftRows(prev => prev.map(r => {
      if (!shiftSelected.has(r._id)) return r;
      const current = String(r[colId] ?? "");
      const updated = search
        ? current.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement)
        : replacement;
      return { ...r, [colId]: updated };
    }));
  };

  const handleShiftExport = () => {
    exportToExcel(shiftCols, shiftRows, "dream_schedule.xlsx")
      .catch(e => showToast("err", e.message));
  };

  // ── Sync button label ─────────────────────────────────────────────────────
  const syncLabel = syncing
    ? "⏳ מסנכרן..."
    : (hasDoc2 && hasDoc1)
      ? `⚡ ייבא ${merged?.length ?? 0} פרופילים + עדכן ספא`
    : hasDoc2
      ? `⚡ ייבא ${merged?.length ?? 0} פרופילים`
      : `⚡ עדכן שעות ספא (${doc1Rec?.length ?? 0} אורחים)`;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = (hasDoc2 && merged)
    ? {
        mode:       "suites",
        total:      merged.length,
        suites:     merged.filter(g => g.hasSuite).length,
        days:       merged.filter(g => g.hasDayBooking && !g.hasSuite).length,
        withSpa:    gridRows.filter(r => r.spa_time).length,
        assigned:   gridRows.filter(r => r.room).length,
        individual: merged.filter(g => g.phoneSource === "individual").length,
      }
    : hasDoc1
      ? {
          mode:    "spa",
          total:   doc1Rec.length,
          withSpa: doc1Rec.filter(r => r.spa_time).length,
        }
      : null;

  const showSuiteGrid = hasDoc2 && merged && merged.length > 0 && !result;
  const showSpaPreview   = !hasDoc2 && hasDoc1 && !result;

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
        <span style={{ fontSize: 18 }}>🗂️</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-dark)", flex: 1 }}>
          ייבוא נתונים — Data Hub
        </span>
        {tab === "suites" && stats && (
          <span style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600 }}>
            {stats.mode === "suites"
              ? `${stats.total} פרופילים · ${stats.assigned} שויכו חדר`
              : `${stats.total} אורחי ספא`}
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

          {/* Profile tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[
              { key: "suites", label: "🏨 כניסות סוויטות" },
              { key: "shifts", label: "📋 סידור משמרות" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: "8px 18px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "Heebo,sans-serif", fontSize: 13, fontWeight: 700,
                background: tab === key ? "var(--gold)" : "var(--ivory)",
                color:      tab === key ? "#0F0F0F"     : "var(--text-muted)",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>

          {tab === "suites" && (<>

          {/* Info banner */}
          <div style={{
            background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.3)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 14,
            fontSize: 12, color: "var(--gold-dark)", lineHeight: 1.8,
          }}>
            <strong>Doc 2 — דוח כניסות EZGO (CSV):</strong> ייבוא חדרים, אורחים, הזמנות<br />
            <strong>Doc 1 — דוח יומי מקיף (Excel):</strong> עדכון שעות ספא בלבד<br />
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              ניתן להעלות כל דוח בנפרד ● ערוך שם/חדר/ספא בטבלה לפני הסנכרון ● שדות בוט חיים לא נדרסים
            </span>
          </div>

          {/* Two drop zones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <DropZone
              label="📋 Doc 2 — כניסות EZGO"
              hint="CSV מ-EZGO (חדרים, שמות, טלפונים)"
              loaded={hasDoc2}
              fileName={doc2Name}
              onFile={handleDoc2}
              inputRef={doc2Ref}
            />
            <DropZone
              label="📊 Doc 1 — דוח יומי מקיף"
              hint="Excel — שעות ספא לפי הזמנה"
              loaded={hasDoc1}
              fileName={doc1Name}
              onFile={handleDoc1}
              inputRef={doc1Ref}
              optional
            />
          </div>

          {/* Stats bar */}
          {stats && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {stats.mode === "suites" ? (
                <>
                  {[
                    { label: "פרופילים",    val: stats.total,      c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "סוויטות",     val: stats.suites,     c: "#b45309", bg: "#fef3c7" },
                    { label: "בילוי יומי",  val: stats.days,       c: "#0e7490", bg: "#ecfeff" },
                    { label: "עם ספא",      val: stats.withSpa,    c: "#16a34a", bg: "#f0fdf4" },
                    { label: "שויכו חדר",   val: stats.assigned,   c: "#92400e", bg: "#fef3c7" },
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
                </>
              ) : (
                <>
                  {[
                    { label: "הזמנות",  val: stats.total,   c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "עם ספא",  val: stats.withSpa, c: "#16a34a", bg: "#f0fdf4" },
                  ].map(({ label, val, c, bg }) => (
                    <div key={label} style={{
                      background: bg, borderRadius: 8, padding: "6px 12px",
                      border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 5,
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                      <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Editable grid — Suite CSV profiles, room dropdown sourced from SUITE_REGISTRY */}
          {showSuiteGrid && (
            <div style={{ marginBottom: 14 }}>
              {selectedIds.size > 0 && (
                <BulkEditBar
                  count={selectedIds.size}
                  columns={SUITES_GRID_COLS}
                  onReplace={handleGridReplace}
                  onClear={() => setSelectedIds(new Set())}
                />
              )}
              <EditableGrid
                columns={SUITES_GRID_COLS}
                rows={gridRows}
                onRowsChange={setGridRows}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </div>
          )}

          {/* Preview — Daily Report only (spa times) */}
          {showSpaPreview && (
            <div style={{
              border: "1px solid var(--border)", borderRadius: 10,
              overflow: "hidden", marginBottom: 14,
            }}>
              <div style={{
                padding: "8px 12px", background: "var(--ivory)",
                fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                borderBottom: "1px solid var(--border)",
              }}>
                עדכון שעות ספא בלבד — לא ייבאו חדרים
              </div>
              <div style={{ overflowX: "auto", maxHeight: 280 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
                  <thead>
                    <tr style={{ background: "var(--ivory)" }}>
                      {["הזמנה #", "שם", "שעת ספא", "# טיפולים"].map(h => (
                        <th key={h} style={{
                          padding: "8px 12px", fontSize: 11, fontWeight: 700,
                          color: "var(--text-muted)", textAlign: "right",
                          borderBottom: "1px solid var(--border)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {doc1Rec.slice(0, 80).map((r, i) => (
                      <tr key={i} style={{
                        borderBottom: "1px solid var(--border)",
                        background: i % 2 === 0 ? "#fff" : "var(--ivory)",
                      }}>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>{r.order_number ?? "—"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{r.guest_name ?? "—"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800,
                          color: r.spa_time ? "var(--gold-dark)" : "var(--text-muted)" }}>
                          {r.spa_time ?? "—"}
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "center" }}>
                          {r.treatment_count > 0 ? r.treatment_count : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sync + reset buttons — visible when either doc is loaded */}
          {canSync && !result && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  flex: 1, padding: "13px", borderRadius: 10, border: "none",
                  background: syncing ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: syncing ? "var(--text-muted)" : "#0F0F0F",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  cursor: syncing ? "not-allowed" : "pointer", transition: "all 0.15s",
                }}>
                {syncLabel}
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
              {result.mode === "suites" ? (
                <>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#065f46", marginBottom: 6 }}>
                    {result.total} אורחים יובאו בהצלחה
                  </div>
                  <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.9 }}>
                    🏨 {result.suites} סוויטות ·
                    ☀️ {result.days} בילוי יומי ·
                    🛏️ {result.rooms} חדרים
                    {result.spa > 0 && <> · 💆 {result.spa} עם שעת ספא</>}
                  </div>
                </>
              ) : (
                <div style={{ color: "#065f46" }}>
                  {result.created > 0 && (
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                      ✨ נוצרו {result.created} אורחים חדשים במערכת
                    </div>
                  )}
                  {result.updated > 0 && (
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                      🔄 עודכנו {result.updated} אורחים קיימים (שעת ספא)
                    </div>
                  )}
                  {result.skipped > 0 && (
                    <div style={{ fontSize: 12, color: "#1d7a5a", marginTop: 4 }}>
                      {result.skipped} רשומות דולגו (ללא טלפון או שגיאה)
                    </div>
                  )}
                </div>
              )}
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
          </>)}

          {tab === "shifts" && (<>
            <div style={{
              background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.3)",
              borderRadius: 8, padding: "10px 14px", marginBottom: 14,
              fontSize: 12, color: "var(--gold-dark)",
            }}>
              כל קובץ Excel — ערוך בגריד וייצא חזרה. לא נכתב ל-DB.
            </div>

            {!shiftRows.length ? (
              <DropZone
                label="📊 קובץ סידור משמרות"
                hint="כל Excel — עמודות נגזרות מהכותרות"
                loaded={false}
                fileName={shiftFileName}
                onFile={handleShiftFile}
                inputRef={shiftRef}
              />
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{shiftFileName}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{shiftRows.length} שורות</span>
                  <div style={{ marginRight: "auto", display: "flex", gap: 8 }}>
                    <button onClick={handleShiftExport} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1.5px solid #1e40af",
                      background: "#eff6ff", color: "#1e40af", fontFamily: "Heebo,sans-serif",
                      fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}>📥 ייצוא Excel</button>
                    <button onClick={() => { setShiftRows([]); setShiftCols([]); setShiftFileName(""); setShiftSelected(new Set()); }} style={{
                      padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
                      background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo,sans-serif",
                      fontSize: 13, color: "var(--text-muted)",
                    }}>✕ נקה</button>
                  </div>
                </div>
                {shiftSelected.size > 0 && (
                  <BulkEditBar
                    count={shiftSelected.size}
                    columns={shiftCols}
                    onReplace={handleShiftReplace}
                    onClear={() => setShiftSelected(new Set())}
                  />
                )}
                <EditableGrid
                  columns={shiftCols}
                  rows={shiftRows}
                  onRowsChange={setShiftRows}
                  selectedIds={shiftSelected}
                  onSelectionChange={setShiftSelected}
                />
              </>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}
