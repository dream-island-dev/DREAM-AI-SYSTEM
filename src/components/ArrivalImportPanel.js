// src/components/ArrivalImportPanel.js
// Unified Import Hub — the SOLE import surface in the app (per session 7 consolidation).
// Lives only inside OperationsBoard.js (formerly TaskBoard.js, session 21). Two profiles:
//
//   "suites" — Doc 2 (any CSV/Excel of room arrivals) → headers sent to the
//              suggest-import-mapping Edge Function (Resilient Import Agent,
//              session 9) → MappingReviewPanel (admin reviews/edits/approves)
//              → aggregateGuestProfiles(rows, approvedMapping) → editable grid
//              (suite dropdown sourced from SUITE_REGISTRY) → sync_suite_arrivals
//              RPC (guests + suite_rooms + bookings, with guests.room denormalized).
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
import MappingReviewPanel from "./MappingReviewPanel";
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import {
  aggregateGuestProfiles,
  profilesToArray,
  enrichProfilesFromExcel,
} from "../utils/ezgoParser";
import { SUITE_ARRIVALS_SCHEMA, buildMaskedSample } from "../utils/importMapper";

// Sorted, joined header signature — matches import_mapping_memory.header_signature (migration 049).
// Not a hash: exact string equality is enough here and avoids a client-side hash dependency.
function _headerSignature(headers) {
  return [...headers].sort().join("␟");
}

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

// ── Deterministic arrival date — staff-controlled picker, NOT auto-guessed ───
// Filename/header/metadata date-sniffing was removed deliberately: a guessed
// date that's silently wrong is worse than requiring one explicit click.
// The picker's value at the moment Doc 2 is dropped becomes the arrival date
// for every profile in that import; iNights (already wired in handleSync via
// _addNights) then derives the exact checkout date from it per-row.
function _todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
    // Financial mapping: sum cPrice/fcPrice across this profile's rooms (usually
    // just one). Staff can still override the total manually in the grid before
    // sync — this is only the parsed starting value, not the final word.
    const totalPrice  = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
    return {
      _id:          g.guestPhone || `row_${i}`,
      _profileIdx:  i,
      guestName:    g.guestName ?? "",
      guestPhone:   g.guestPhone ?? "",
      phoneSource:  g.phoneSource === "individual" ? "פרטי" : "קואורד׳",
      roomCount:    (g.rooms ?? []).length > 1 ? `${g.rooms.length} חדרים` : "",
      room:         (g.rooms ?? []).length > 1 ? "" : (isDay ? (singleRoom?.isDayGuest ? guess : "") : guess),
      tier:         isDay ? "☀️ בילוי יומי" : "🏨 סוויטה",
      spa_time:     g.spa_time ?? "",
      amount:       totalPrice || "",
      arrivalDate:  g.arrivalDate ?? "",
    };
  });
}

const SUITES_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",   editable: true,  w: 150 },
  { id: "guestPhone",  label: "טלפון",      editable: false, w: 120 },
  { id: "phoneSource", label: "מקור",       editable: false, w: 80  },
  { id: "roomCount",   label: "קבוצה",      editable: false, w: 70  },
  { id: "tier",        label: "שכבה",       editable: false, w: 90  },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true, w: 190, gold: true, options: ROOM_OPTIONS },
  { id: "spa_time",    label: "שעת ספא",    editable: true,  w: 90  },
  { id: "amount",      label: "💰 סכום (₪)", editable: true, w: 100 },
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

export default function ArrivalImportPanel({ defaultOpen = false } = {}) {
  const [open,     setOpen]     = useState(defaultOpen);
  const [tab,      setTab]      = useState("suites"); // "suites" | "shifts"

  // Suites profile state
  const [doc2Map,  setDoc2Map]  = useState(null);   // Map<key, profile> from Suite CSV
  const [doc1Rec,  setDoc1Rec]  = useState(null);   // [] from Daily Report Excel
  const [doc2Name, setDoc2Name] = useState("");
  const [doc1Name, setDoc1Name] = useState("");
  // Deterministic arrival date — staff sets this BEFORE dropping Doc 2; its
  // value at upload time becomes every profile's arrival date (no filename
  // or in-file date column is auto-parsed anymore).
  const [arrivalDate, setArrivalDate] = useState(_todayISO());
  const [merged,   setMerged]   = useState(null);   // enriched profiles array (doc2 + doc1 join)
  const [gridRows, setGridRows] = useState([]);      // editable grid rows derived from merged
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [toast,    setToast]    = useState(null);
  const doc2Ref = useRef();
  const doc1Ref = useRef();

  // Resilient Import Agent — mapping review state (Doc 2 / Suite CSV only)
  const [mappingStage, setMappingStage] = useState("idle"); // "idle" | "suggesting" | "review"
  const [rawDoc2Rows,  setRawDoc2Rows]  = useState(null);   // parsed SheetJS rows, kept for re-processing after approval
  const [doc2Fallback, setDoc2Fallback] = useState(null);   // arrivalDate picker snapshot, captured at upload time
  const [aiSuggestion, setAiSuggestion] = useState(null);   // { mapping, defaults, recommendations, confidence, engine } | null
  const [aiError,      setAiError]      = useState(null);   // string | null — shown, never hidden, when the AI call failed

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

  // ── Parse Doc 2: Suite CSV → AI-suggested column mapping → review screen ──
  // The AI only proposes; aggregateGuestProfiles() runs unchanged once the
  // admin approves a mapping in MappingReviewPanel (see handleMappingApprove).
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

      if (!rows.length) {
        showToast("err", "הקובץ ריק");
        return;
      }

      const headers = Object.keys(rows[0]);
      setRawDoc2Rows(rows);
      // Deterministic date: capture the date picker's state at upload time —
      // no filename/header/metadata guessing. See _todayISO() comment above.
      setDoc2Fallback(arrivalDate || _todayISO());
      setMappingStage("suggesting");

      // ── Mapping memory: skip the AI call when this exact header set was
      // approved before. The review screen still always shows — this only
      // saves a round-trip to Gemini, never the human approval step.
      const signature = _headerSignature(headers);
      let remembered = null;
      if (supabase) {
        const { data: mem } = await supabase
          .from("import_mapping_memory")
          .select("approved_mapping")
          .eq("schema_key", "suite_arrivals")
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
            body: { schemaKey: "suite_arrivals", headers, sampleRows: sample },
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
      showToast("err", "שגיאה בקריאת Suite CSV: " + err.message);
      setMappingStage("idle");
    }
  }, [arrivalDate]);

  // ── Admin approved a mapping in the review screen — run the unchanged
  // extraction/grid/RPC pipeline with it, and remember it for next time. ──
  const handleMappingApprove = useCallback((finalMapping, appliedDefaults) => {
    if (!rawDoc2Rows) return;
    const profileMap = aggregateGuestProfiles(rawDoc2Rows, finalMapping, doc2Fallback);
    if (appliedDefaults.arrivalDate) {
      for (const profile of profileMap.values()) {
        if (!profile.arrivalDate) profile.arrivalDate = appliedDefaults.arrivalDate;
      }
    }
    // Deterministic dates: the staff-set picker (doc2Fallback, captured at upload
    // time) is the ONLY arrival date source, full stop — even if the AI mapped some
    // column to the "arrivalDate" role and it parsed to a real value. Force it here
    // rather than relying on every upstream priority order to agree.
    for (const profile of profileMap.values()) {
      profile.arrivalDate = doc2Fallback;
    }
    if (!profileMap.size) {
      showToast("err", "לא נמצאו פרופילים — בדוק את המיפוי או שהקובץ ריק");
      setMappingStage("review");
      return;
    }
    setDoc2Map(profileMap);
    setMappingStage("idle");

    // Best-effort — never blocks the import if this fails
    if (supabase) {
      const signature = _headerSignature(Object.keys(rawDoc2Rows[0] ?? {}));
      supabase.from("import_mapping_memory")
        .upsert(
          { schema_key: "suite_arrivals", header_signature: signature, approved_mapping: finalMapping, last_used_at: new Date().toISOString() },
          { onConflict: "schema_key,header_signature" },
        )
        .then(({ error }) => {
          if (error) console.warn("[ArrivalImportPanel] failed to save mapping memory:", error.message);
        });
    }
  }, [rawDoc2Rows, doc2Fallback]);

  const handleMappingCancel = useCallback(() => {
    setMappingStage("idle");
    setRawDoc2Rows(null);
    setDoc2Fallback(null);
    setAiSuggestion(null);
    setAiError(null);
    setDoc2Name("");
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
            // Financial mapping: staff's edited grid amount wins; otherwise the
            // parsed cPrice/fcPrice total computed in _profilesToGridRows.
            const editedAmount = edited.amount !== undefined && edited.amount !== ""
              ? parseFloat(edited.amount) : null;
            const computedAmount = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
            return {
              guestPhone:      g.guestPhone,
              guestName:       edited.guestName ?? g.guestName ?? "",
              arrivalDate:     g.arrivalDate ?? null,
              departureDate:   _addNights(g.arrivalDate, nights),
              orderNumber:     [...(g.orderNumbers ?? [])][0] ?? null,
              hasSuite:        !!g.hasSuite,
              // Daily Leisure Guests need their own room_type ('day_guest'), not
              // 'standard' — otherwise GuestDashboard's tab bucketing misfiles them.
              isDayGuest:      !!g.hasDayBooking,
              treatment_count: g.treatment_count ?? 0,
              paymentAmount:   editedAmount ?? (computedAmount || null),
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
          // FAIL VISIBLE: the RPC already returns this count (rows with no resLineId/orderNumber
          // never reached the DB) — it just wasn't surfaced anywhere before. Show it, don't hide it.
          skippedRooms: rpcData?.skipped ?? 0,
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
    setMappingStage("idle"); setRawDoc2Rows(null); setDoc2Fallback(null);
    setAiSuggestion(null); setAiError(null);
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
        withAmount: gridRows.filter(r => r.amount).length,
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
          padding: "14px 20px", cursor: "pointer", userSelect: "none",
          background: "linear-gradient(135deg, #1c1c1c, #0F0F0F)",
          border: "1px solid var(--gold)",
          borderRadius: open ? "16px 16px 0 0" : 16,
          boxShadow: "0 4px 22px rgba(201,169,110,0.18)",
          transition: "border-radius 0.15s",
        }}
      >
        <span style={{ fontSize: 18 }}>🗂️</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-light)", flex: 1 }}>
          ייבוא נתונים — Data Hub
        </span>
        {tab === "suites" && stats && (
          <span style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600 }}>
            {stats.mode === "suites"
              ? `${stats.total} פרופילים · ${stats.assigned} שויכו חדר`
              : `${stats.total} אורחי ספא`}
          </span>
        )}
        <span style={{ color: "rgba(232,201,138,0.55)", fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          border: "1px solid var(--gold)", borderTop: "none",
          borderRadius: "0 0 16px 16px", padding: "20px 18px 22px",
          background: "linear-gradient(160deg, #161616, #0F0F0F)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
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
                background: tab === key ? "linear-gradient(135deg,var(--gold),var(--gold-dark))" : "rgba(255,255,255,0.06)",
                color:      tab === key ? "#0F0F0F"     : "var(--gold-light)",
                boxShadow:  tab === key ? "0 3px 14px rgba(201,169,110,0.3)" : "none",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>

          {tab === "suites" && (<>

          {/* Info banner */}
          <div style={{
            background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.3)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 14,
            fontSize: 12, color: "var(--gold-light)", lineHeight: 1.8,
          }}>
            <strong>Doc 2 — דוח כניסות EZGO (CSV):</strong> ייבוא חדרים, אורחים, הזמנות<br />
            <strong>Doc 1 — דוח יומי מקיף (Excel):</strong> עדכון שעות ספא בלבד<br />
            <span style={{ color: "rgba(232,201,138,0.55)", fontSize: 11 }}>
              ניתן להעלות כל דוח בנפרד ● ערוך שם/חדר/ספא בטבלה לפני הסנכרון ● שדות בוט חיים לא נדרסים
            </span>
          </div>

          {/* Deterministic arrival date — staff-controlled, captured at the moment
              Doc 2 is dropped. No filename/header/metadata date guessing. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.25)",
          }}>
            <label style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed", whiteSpace: "nowrap" }}>
              📅 תאריך הגעה לייבוא זה
            </label>
            <input
              type="date"
              value={arrivalDate}
              onChange={e => setArrivalDate(e.target.value)}
              style={{
                padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.4)",
                fontSize: 14, fontFamily: "Heebo,sans-serif", direction: "ltr",
              }}
            />
            <span style={{ fontSize: 11, color: "rgba(196,181,253,0.75)" }}>
              חל על כל הפרופילים בקובץ Doc 2 — תאריך העזיבה יחושב אוטומטית לפי מספר הלילות (iNights)
            </span>
          </div>

          {/* Two drop zones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <DropZone
              label="📋 Doc 2 — כניסות אורחים"
              hint="כל CSV/Excel — עמודות מזוהות אוטומטית"
              loaded={hasDoc2 || mappingStage !== "idle"}
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

          {/* Resilient Import Agent — mapping suggestion + review gate */}
          {mappingStage === "suggesting" && (
            <div style={{
              textAlign: "center", padding: "24px", color: "var(--gold-light)",
              fontSize: 13, border: "1px dashed rgba(201,169,110,0.35)", borderRadius: 10, marginBottom: 14,
            }}>
              🤖 מנתח כותרות עמודות ומציע מיפוי...
            </div>
          )}
          {mappingStage === "review" && rawDoc2Rows && (
            <MappingReviewPanel
              schema={SUITE_ARRIVALS_SCHEMA}
              headers={Object.keys(rawDoc2Rows[0] ?? {})}
              sampleRow={rawDoc2Rows[0]}
              aiSuggestion={aiSuggestion}
              aiError={aiError}
              onApprove={handleMappingApprove}
              onCancel={handleMappingCancel}
            />
          )}

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
                    { label: "עם סכום",     val: stats.withAmount, c: "#0369a1", bg: "#eff6ff" },
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
                  flex: 1, padding: "13px", borderRadius: 12, border: "none",
                  background: syncing ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: syncing ? "rgba(232,201,138,0.5)" : "#0F0F0F",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  boxShadow: syncing ? "none" : "0 6px 22px rgba(201,169,110,0.4)",
                  cursor: syncing ? "not-allowed" : "pointer", transition: "all 0.15s",
                }}>
                {syncLabel}
              </button>
              <button onClick={reset} style={{
                padding: "13px 16px", borderRadius: 12,
                border: "1px solid rgba(201,169,110,0.3)", background: "rgba(255,255,255,0.05)",
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
                fontSize: 13, color: "var(--gold-light)",
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
                  {result.skippedRooms > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      ⚠ {result.skippedRooms} שורות חדר דולגו (חסר מספר הזמנה או מזהה שורה) — לא סונכרנו ל-DB
                    </div>
                  )}
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
              background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.3)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 14,
              fontSize: 12, color: "var(--gold-light)",
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
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--gold-light)" }}>{shiftFileName}</span>
                  <span style={{ fontSize: 12, color: "rgba(232,201,138,0.55)" }}>{shiftRows.length} שורות</span>
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
