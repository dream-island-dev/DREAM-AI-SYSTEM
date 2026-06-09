// src/components/ShiftGenerator.js
// AI Shift Generator workspace: upload a past schedule + free-text Hebrew
// constraints → Gemini (primary)/Claude (fallback) generate a balanced week →
// Review & Approve → insert into Supabase + queue WhatsApp staff notifications.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Smart Excel Recognizer v2 — Multi-format, Admin-tunable ─────────────────
const HEBREW_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HEBREW_DAYS_SHORT = ["א'","ב'","ג'","ד'","ה'","ו'","ש'"];
const NAME_KEYS = ["שם","עובד","שם עובד","שם מלא","name","employee"];

// Values that are NEVER employee names (Hebrew + English shift types/positions)
const CORE_OFF_VALUES = new Set([
  // Hebrew
  "חופש","חפ","חו","x","X","-","","null","פנוי","יום חופש","חג","מחלה","שמירה",
  "בוקר","ערב","לילה","צהריים","כוננות","נוכחות","מנהל","כללי",
  // English shift statuses
  "day off","off","holiday","vacation","sick","absent","free","rest","close",
  // English work stations / positions (common in Israeli hotels)
  "toilet","kitchen","live kitchen","bar","pool","lobby","reception",
  "cleaning","maintenance","housekeeping","restaurant","spa","garden",
  "shift","morning","evening","night","afternoon","standby","on call",
  // Numbers / symbols
  "0","1","2","3","4","5","6","7","8","9",
]);

// Load admin-saved custom blacklist from localStorage
function loadCustomBlacklist() {
  try {
    const saved = localStorage.getItem("dreamIsland_empBlacklist");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch { return new Set(); }
}
function saveCustomBlacklist(set) {
  try { localStorage.setItem("dreamIsland_empBlacklist", JSON.stringify([...set])); } catch {}
}
function loadCustomWhitelist() {
  try {
    const saved = localStorage.getItem("dreamIsland_empWhitelist");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch { return new Set(); }
}
function saveCustomWhitelist(set) {
  try { localStorage.setItem("dreamIsland_empWhitelist", JSON.stringify([...set])); } catch {}
}

function isOffValue(val, customBlacklist) {
  const v = String(val ?? "").trim().toLowerCase();
  return (
    !v || v === "null" ||
    CORE_OFF_VALUES.has(v) ||
    customBlacklist.has(v) ||
    /^\d{1,2}:\d{2}$/.test(v)   // time strings like "07:00"
  );
}

// ── Schema Detection: 3 Excel formats ───────────────────────────────────────
// A) employee-rows  — first col = name, day cols = shift type (בוקר/ערב)
// B) station-rows   — first col = station/position, day cols = employee names
// C) shift-rows     — each row is one shift (name, date, start, end)
//
// Supports day headers in Hebrew ("ראשון"), abbreviated ("א'"), date formats
// like "12/6", "12.6.2026", "2026-06-12", "Sun 12" etc.
// AND Excel serial date numbers (e.g. 46549 = June 7 2026).

// Parse a column header string into a JS Date.
// Handles: Excel serial numbers, DD/MM/YYYY, DD/MM, YYYY-MM-DD.
// Returns null if the key cannot be interpreted as a date.
function parseDateHeader(key) {
  const s = String(key).trim();

  // ── Excel serial date number (range ~43000–50000 covers years ~2017–2036) ──
  const n = Number(s);
  if (!isNaN(n) && n > 43000 && n < 50000) {
    // Excel epoch = Dec 30 1899; 25569 = Excel serial for Unix epoch (Jan 1 1970)
    const utcMs = (n - 25569) * 86400000;
    const tmp   = new Date(utcMs);
    // Re-create in local time so .getDay() returns the correct calendar day-of-week
    return new Date(tmp.getUTCFullYear(), tmp.getUTCMonth(), tmp.getUTCDate());
  }

  // ── DD/MM/YYYY  |  DD.MM.YYYY  |  DD-MM-YYYY ─────────────────────────────
  const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const year = m1[3].length === 2 ? 2000 + parseInt(m1[3]) : parseInt(m1[3]);
    return new Date(year, parseInt(m1[2]) - 1, parseInt(m1[1]));
  }

  // ── DD/MM  |  DD.MM  (no year — assume current year) ─────────────────────
  const m2 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m2) {
    return new Date(new Date().getFullYear(), parseInt(m2[2]) - 1, parseInt(m2[1]));
  }

  // ── YYYY-MM-DD ────────────────────────────────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  return null;
}

function isDayHeader(k) {
  const s = String(k).trim();
  return (
    HEBREW_DAYS.some(d => s.includes(d)) ||
    HEBREW_DAYS_SHORT.some(d => s === d) ||
    /^\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?$/.test(s) ||    // 12/6  |  12.6.2026
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||                           // 2026-06-12
    /^(sun|mon|tue|wed|thu|fri|sat)/i.test(s) ||               // Sun / Sunday
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s) || // Jun 12
    // Excel serial date number (range ~43000–50000 covers years ~2017–2036)
    (!isNaN(Number(s)) && Number(s) > 43000 && Number(s) < 50000)
  );
}

function detectExcelSchema(rows) {
  if (!rows.length) return { schema: "unknown", confidence: 0 };
  const keys = Object.keys(rows[0]);

  // No day columns → shift-rows
  const hasDayCols = keys.some(isDayHeader);
  if (!hasDayCols) return { schema: "shift-rows", confidence: 0.9 };

  // Look at cell values to decide A vs B
  const dayKeys = keys.filter(isDayHeader);
  const SHIFT_WORDS = new Set(["בוקר","ערב","לילה","צהריים","morning","evening","night","off","day off","חופש","-","x"]);

  let namesInCells = 0, shiftsInCells = 0, totalCells = 0;
  rows.slice(0, 8).forEach(row => {
    dayKeys.forEach(k => {
      const v = String(row[k] ?? "").trim();
      if (!v || v === "null" || v === "-") return;
      totalCells++;
      if (SHIFT_WORDS.has(v.toLowerCase())) shiftsInCells++;
      // Hebrew name heuristic: 2-12 chars, only Hebrew letters or space
      else if (/^[֐-׿\s]{2,12}$/.test(v) || /^[a-zA-Z\s]{3,15}$/.test(v)) namesInCells++;
    });
  });

  // Also check: does first column look like positions (English words, known stations)?
  const nameCol = NAME_KEYS.find(k => keys.some(rk => rk.trim() === k)) ?? keys[0];
  let firstColLooksLikeStations = 0;
  rows.slice(0, 6).forEach(row => {
    const v = String(row[nameCol] ?? "").trim().toLowerCase();
    if (CORE_OFF_VALUES.has(v) && v) firstColLooksLikeStations++;
  });

  const stationConfidence = (namesInCells / Math.max(totalCells, 1)) + (firstColLooksLikeStations / Math.max(rows.length, 1));
  const employeeConfidence = shiftsInCells / Math.max(totalCells, 1);

  if (stationConfidence > 0.3 || firstColLooksLikeStations >= 2) {
    return { schema: "station-rows", confidence: Math.min(stationConfidence, 1), dayKeys, nameCol };
  }
  return { schema: "employee-rows", confidence: employeeConfidence, dayKeys, nameCol };
}

// Extract names from "station-rows" format: names ARE in the day-cells
function extractNamesFromCells(rows, dayKeys, customBlacklist) {
  const seen = new Set();
  const whitelist = loadCustomWhitelist();
  rows.forEach(row => {
    (dayKeys ?? []).forEach(k => {
      const v = String(row[k] ?? "").trim();
      if (!v || v === "null") return;
      // Some cells might have multiple names like "ליאור / נועה" or "ליאור+נועה"
      v.split(/[/+,\n&]/).forEach(part => {
        const n = part.trim();
        if (!n) return;
        if (whitelist.has(n.toLowerCase())) { seen.add(n); return; }
        if (!isOffValue(n, customBlacklist) && n.length >= 2 && n.length <= 20) seen.add(n);
      });
    });
  });
  return [...seen];
}

// Extract names from "employee-rows" format: names ARE in the first column
function extractNamesFromFirstCol(rows, nameCol, customBlacklist) {
  const seen = new Set();
  const whitelist = loadCustomWhitelist();
  rows.forEach(row => {
    const n = String(row[nameCol ?? Object.keys(row)[0]] ?? "").trim();
    if (!n) return;
    if (whitelist.has(n.toLowerCase())) { seen.add(n); return; }
    if (!isOffValue(n, customBlacklist) && n.length >= 2 && n.length <= 20) seen.add(n);
  });
  return [...seen];
}

// Master extraction — auto-detects format, returns { names, schema, schemaLabel }
function extractNamesFromExcel(rows, customBlacklist = new Set()) {
  if (!rows.length) return { names: [], schema: "unknown", schemaLabel: "לא זוהה" };
  const { schema, dayKeys, nameCol } = detectExcelSchema(rows);

  let names = [];
  let schemaLabel = "";
  if (schema === "station-rows") {
    names = extractNamesFromCells(rows, dayKeys, customBlacklist);
    schemaLabel = "תחנות-שורה (שמות בתאים)";
  } else if (schema === "employee-rows") {
    names = extractNamesFromFirstCol(rows, nameCol, customBlacklist);
    schemaLabel = "עובד-שורה (שמות בעמודה הראשונה)";
  } else {
    // shift-rows — try first col
    names = extractNamesFromFirstCol(rows, null, customBlacklist);
    schemaLabel = "משמרות נפרדות";
  }
  return { names, schema, schemaLabel };
}

// Summarise shift patterns per employee for learning panel — supports all 3 schemas
function buildLearnedSummary(rows, schema) {
  if (!rows.length) return [];
  const { dayKeys, nameCol } = detectExcelSchema(rows);
  const customBL = loadCustomBlacklist();
  const summaryMap = {};   // name → Set of "dayName: station/shift"

  if (schema === "employee-rows" || schema === "shift-rows") {
    const keys = Object.keys(rows[0]);
    rows.forEach(row => {
      const name = String(row[nameCol ?? keys[0]] ?? "").trim();
      if (!name || isOffValue(name, customBL)) return;
      (dayKeys ?? keys.filter(k => k !== (nameCol ?? keys[0]))).forEach(col => {
        const val = String(row[col] ?? "").trim();
        if (val && !isOffValue(val, customBL)) {
          const day = Object.keys(DAY_OFFSETS).find(d => String(col).includes(d)) ?? col;
          if (!summaryMap[name]) summaryMap[name] = new Set();
          summaryMap[name].add(`${day}: ${val}`);
        }
      });
    });

  } else if (schema === "station-rows") {
    // Row = station, cells = employee names
    const stationCol = nameCol ?? Object.keys(rows[0])[0];
    rows.forEach(row => {
      const station = String(row[stationCol] ?? "").trim();
      if (!station || isOffValue(station, customBL)) return;
      (dayKeys ?? []).forEach(dayCol => {
        const cellVal = String(row[dayCol] ?? "").trim();
        if (!cellVal || cellVal === "null") return;
        cellVal.split(/[/+,\n&]/).forEach(part => {
          const n = part.replace(/\d{1,2}:\d{2}\s*[-/]\s*\d{1,2}:\d{2}/g, "").trim();
          if (!n || isOffValue(n, customBL) || n.length < 2) return;
          if (!summaryMap[n]) summaryMap[n] = new Set();
          const day = Object.keys(DAY_OFFSETS).find(d => String(dayCol).includes(d)) ?? dayCol;
          summaryMap[n].add(`${day}: ${station}`);
        });
      });
    });
  }

  return Object.entries(summaryMap)
    .map(([name, shiftSet]) => ({ name, shifts: [...shiftSet] }))
    .filter(e => e.shifts.length > 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// DEEP PATTERN LEARNING — buildEmployeeProfiles
// Converts raw Excel rows into rich employee profiles that the AI can use
// to DUPLICATE the schedule (not invent a new one).
//
// Profile per employee:
//  { name, workDays: [{dayIndex, dayName, station, start, end}], offDays: [...] }
// ══════════════════════════════════════════════════════════════════════════════
function buildEmployeeProfiles(rows, schema, customBlacklist, weekStartDate) {
  if (!rows.length) return [];
  const { dayKeys, nameCol } = detectExcelSchema(rows);

  // For each employee we'll collect: which day → which station + hours
  const profileMap = {};   // name → { workDays: [...], offDays: [...] }
  const whitelist = loadCustomWhitelist();

  if (schema === "station-rows") {
    // Row = station/position. Cells = employee name assigned to that station that day.
    // e.g.: { "תחנה": "toilet", "ראשון": "mihiran", "שני": "asanka", ... }
    const stationCol = nameCol ?? Object.keys(rows[0])[0];

    rows.forEach(row => {
      const station = String(row[stationCol] ?? "").trim();
      if (!station || isOffValue(station, customBlacklist)) return;

      // Look at each day column
      (dayKeys ?? Object.keys(row).filter(k => k !== stationCol)).forEach(dayCol => {
        const cellVal = String(row[dayCol] ?? "").trim();
        if (!cellVal || cellVal === "null") return;

        // Try to detect if cell has time range "07:00-18:30" or "07:00/18:30"
        const timeMatch = cellVal.match(/(\d{1,2}:\d{2})\s*[-/]\s*(\d{1,2}:\d{2})/);
        let start = "", end = "";
        let empName = cellVal;

        if (timeMatch) {
          start = timeMatch[1];
          end = timeMatch[2];
          empName = cellVal.replace(timeMatch[0], "").trim();
        }

        // Split multiple names in one cell
        const names = empName.split(/[/+,\n&]/).map(n => n.trim()).filter(n =>
          n && !isOffValue(n, customBlacklist) && (whitelist.has(n.toLowerCase()) || (n.length >= 2 && n.length <= 20))
        );

        // Find day offset (0=ראשון/Sun … 6=שבת/Sat)
        // Primary: Hebrew day name in column header
        let dayOffset = Object.entries(DAY_OFFSETS).find(([d]) => String(dayCol).includes(d))?.[1] ?? -1;
        // Fallback: column header is a date (serial number, DD/MM, DD/MM/YYYY, YYYY-MM-DD)
        if (dayOffset === -1) {
          const parsed = parseDateHeader(dayCol);
          if (parsed) dayOffset = parsed.getDay(); // 0=Sun … 6=Sat
        }
        if (dayOffset === -1) return; // unrecognised column — skip

        // Compute actual date for this day
        const d = new Date(weekStartDate ?? "2026-01-01");
        d.setDate(d.getDate() + dayOffset);
        const dateStr = d.toISOString().slice(0, 10);

        names.forEach(name => {
          if (!profileMap[name]) profileMap[name] = { name, workDays: [] };
          profileMap[name].workDays.push({
            dayIndex: dayOffset,
            dayName:  Object.keys(DAY_OFFSETS).find(k => DAY_OFFSETS[k] === dayOffset && k.length > 1) ?? String(dayOffset),
            date:     dateStr,
            station:  station,
            start:    start || inferStartFromStation(station),
            end:      end   || inferEndFromStation(station),
          });
        });
      });
    });

  } else if (schema === "employee-rows") {
    // Row = employee. Cells = shift type (בוקר/ערב/לילה) or time range.
    rows.forEach(row => {
      const name = String(row[nameCol ?? Object.keys(row)[0]] ?? "").trim();
      if (!name || isOffValue(name, customBlacklist)) return;
      if (!profileMap[name]) profileMap[name] = { name, workDays: [] };

      (dayKeys ?? []).forEach(dayCol => {
        const val = String(row[dayCol] ?? "").trim();
        if (!val || isOffValue(val, customBlacklist)) return;

        // Primary: Hebrew day name; Fallback: date header (serial / DD/MM / etc.)
        let dayOffset = Object.entries(DAY_OFFSETS).find(([d]) => String(dayCol).includes(d))?.[1] ?? -1;
        if (dayOffset === -1) {
          const parsed = parseDateHeader(dayCol);
          if (parsed) dayOffset = parsed.getDay();
        }
        if (dayOffset === -1) return;

        const d = new Date(weekStartDate ?? "2026-01-01");
        d.setDate(d.getDate() + dayOffset);
        const dateStr = d.toISOString().slice(0, 10);

        // Parse time range from cell
        const timeMatch = val.match(/(\d{1,2}:\d{2})\s*[-/]\s*(\d{1,2}:\d{2})/);
        const shiftType = timeMatch ? val.replace(timeMatch[0], "").trim() : val;
        const times = SHIFT_TIMES[shiftType] ?? { start: timeMatch?.[1] ?? "08:00", end: timeMatch?.[2] ?? "16:00" };

        profileMap[name].workDays.push({
          dayIndex: dayOffset,
          dayName:  Object.keys(DAY_OFFSETS).find(k => DAY_OFFSETS[k] === dayOffset && k.length > 1) ?? String(dayOffset),
          date:     dateStr,
          station:  shiftType,
          start:    timeMatch?.[1] ?? times.start,
          end:      timeMatch?.[2] ?? times.end,
        });
      });
    });
  }

  // Compute offDays and sort workDays
  const allDayIndices = new Set([0,1,2,3,4,5,6]);
  return Object.values(profileMap).map(profile => {
    const workedIndices = new Set(profile.workDays.map(d => d.dayIndex));
    const offDays = [...allDayIndices].filter(i => !workedIndices.has(i))
      .map(i => Object.keys(DAY_OFFSETS).find(k => DAY_OFFSETS[k] === i && k.length > 1) ?? String(i));
    profile.workDays.sort((a, b) => a.dayIndex - b.dayIndex);
    return { ...profile, offDays };
  }).filter(p => p.workDays.length > 0);
}

// Infer hours from common station names
function inferStartFromStation(station) {
  const s = station.toLowerCase();
  if (s.includes("night") || s.includes("לילה")) return "23:00";
  if (s.includes("evening") || s.includes("ערב")) return "15:00";
  return "07:00";
}
function inferEndFromStation(station) {
  const s = station.toLowerCase();
  if (s.includes("night") || s.includes("לילה")) return "07:00";
  if (s.includes("evening") || s.includes("ערב")) return "23:00";
  return "16:00";
}

// ══════════════════════════════════════════════════════════════════════════════
// DUPLICATE MODE — client-side, zero AI, zero API calls
// Mirrors the Edge Function's duplicateScheduleLocally() exactly.
// Called when employeeProfiles exist AND no constraints → instant result.
// ══════════════════════════════════════════════════════════════════════════════
function duplicateScheduleLocally(profiles, weekStart, department, constraints) {
  const rows = [];
  for (const profile of profiles) {
    const name     = String(profile.name ?? "");
    const workDays = profile.workDays ?? [];
    for (const wd of workDays) {
      const dayIndex = Number(wd.dayIndex ?? 0);
      const d = new Date(weekStart);
      d.setDate(d.getDate() + dayIndex);
      const date = d.toISOString().slice(0, 10);
      rows.push({
        employeeName: name,
        department:   department || String(profile.department ?? ""),
        date,
        start:   String(wd.start   ?? "08:00"),
        end:     String(wd.end     ?? "16:00"),
        station: String(wd.station ?? ""),
        status:  "עתידי",
        notes:   constraints?.trim() ? `אילוץ: ${constraints.slice(0, 80)}` : "",
      });
    }
  }
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName)
  );
}

const SHIFT_TIMES = {
  "בוקר":   { start: "07:00", end: "15:00" },
  "צהריים": { start: "11:00", end: "19:00" },
  "ערב":    { start: "15:00", end: "23:00" },
  "לילה":   { start: "23:00", end: "07:00" },
  "מנהל":   { start: "08:00", end: "16:00" },
  "כוננות": { start: "00:00", end: "24:00" },
  "כללי":   { start: "08:00", end: "16:00" },
  "נוכחות": { start: "08:00", end: "16:00" },
};
const DAY_OFFSETS = {
  "ראשון":0,"א'":0,"א":0,
  "שני":1,"ב'":1,"ב":1,
  "שלישי":2,"ג'":2,"ג":2,
  "רביעי":3,"ד'":3,"ד":3,
  "חמישי":4,"ה'":4,"ה":4,
  "שישי":5,"ו'":5,"ו":5,
  "שבת":6,"ש'":6,"ש":6,
};

function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

const DEPT_LABEL = {
  housekeeping: "🛏️ ניקיון וחדרים",
  maintenance:  "🔧 תחזוקה",
  reception:    "🏨 קבלה ופרונט",
  spa:          "💆 ספא ובריאות",
  management:   "📋 ניהול כללי",
};

export default function ShiftGenerator({ onApproved, user }) {
  const [employees, setEmployees]           = useState([]);
  const [extractedEmployees, setExtractedEmployees] = useState([]); // confirmed employee list
  const [employeeProfiles, setEmployeeProfiles]     = useState([]); // deep learned profiles
  const [learnedSummary, setLearnedSummary] = useState([]);
  const [detectedSchema, setDetectedSchema] = useState("");         // format label
  const [customBlacklist, setCustomBlacklist] = useState(() => loadCustomBlacklist());
  const [showAdminTuner, setShowAdminTuner] = useState(false);
  const [newBlackWord, setNewBlackWord]     = useState("");
  const [pastShifts, setPastShifts]         = useState([]);
  const [pastName, setPastName]             = useState("");
  const [constraints, setConstraints]       = useState("");
  const [weekStart, setWeekStart]           = useState(nextSunday());
  const [draftShifts, setDraftShifts]       = useState(null); // draft only — saved on approval
  const [engine, setEngine]                 = useState(null);
  const [generating, setGenerating]         = useState(false);
  const [generateStep, setGenerateStep]     = useState("");
  const [approving, setApproving]           = useState(false);
  const [toast, setToast]                   = useState(null);
  const [managerDepartment, setManagerDepartment] = useState(null);
  const inputRef = useRef(null);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4500); };

  // Fetch employees filtered by department, and manager's own department
  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !supabase) return;
      const { data } = await supabase.from("employees").select("id,name,department,role");
      setEmployees(data ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !supabase) return;
    supabase
      .from("profiles")
      .select("department")
      .eq("id", user.id)
      .single()
      .then(({ data }) => { if (data?.department) setManagerDepartment(data.department); });
  }, [user?.id]);

  const parsePast = useCallback((file) => {
    if (!file) return;

    // Guard: mobile browsers sometimes ignore the accept attribute and let users
    // pick any file. Catch PDFs early with a clear redirect message.
    if (
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf")
    ) {
      showToast(
        "err",
        "קובץ PDF אינו נתמך כאן. סידור קודם יש להעלות בפורמט אקסל בלבד. " +
        "נהלי עבודה ב-PDF יש להעלות דרך מרכז הגדרות הסוכן."
      );
      // Reset the hidden input so the same file can retrigger onChange if needed
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setPastName(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(e.target.result, { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
        setPastShifts(rows);

        // ── Smart extraction ─────────────────────────────────────────────────
        const { names, schema, schemaLabel } = extractNamesFromExcel(rows, customBlacklist);
        setDetectedSchema(schemaLabel);
        setExtractedEmployees(names);

        // ── Deep pattern learning ─────────────────────────────────────────────
        const profiles = buildEmployeeProfiles(rows, schema, customBlacklist, weekStart);
        setEmployeeProfiles(profiles);

        // Build visual summary
        const summary = buildLearnedSummary(rows, schema);
        setLearnedSummary(summary);

        showToast(
          names.length > 0 ? "ok" : "err",
          names.length > 0
            ? `🧠 פורמט: ${schemaLabel} · ${names.length} עובדים · ${profiles.length} פרופילי משמרות`
            : `⚠️ לא זוהו עובדים (${schemaLabel}) — פתח כוונון 🔧`
        );
      } catch (err) { showToast("err", "שגיאה בקריאת הקובץ: " + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }, [weekStart, customBlacklist]);

  // ── Upsert extracted employees to DB (before generation) ────────────────────
  // Uses UPSERT on conflict(name) — never creates duplicates, safe to call repeatedly.
  const persistConfirmedEmployees = async (names) => {
    if (!names.length || !isSupabaseConfigured || !supabase) return 0;
    try {
      const dept = managerDepartment || "כללי";
      const rows = names.map(n => ({
        id:         Date.now() + Math.floor(Math.random() * 1e6),
        name:       n,
        department: dept,
        role:       "עובד",
        status:     "פעיל",
      }));
      // onConflict: 'name' — skip existing employees, insert only new ones
      const { error } = await supabase
        .from("employees")
        .upsert(rows, { onConflict: "name", ignoreDuplicates: true });
      if (error) throw error;
      const { data: fresh } = await supabase.from("employees").select("id,name,department,role,phone");
      setEmployees(fresh ?? []);
      // Return count of truly new records by comparing before vs after
      return names.length; // approximate — exact count via fresh vs prior not worth the query
    } catch (e) { console.warn("[ShiftGenerator] persist employees:", e.message); }
    return 0;
  };

  const generate = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");

    // Use DB employees OR confirmed-from-Excel employees
    const effectiveEmployees = employees.length > 0
      ? employees
      : extractedEmployees.map(name => ({ name, department: managerDepartment || "כללי", role: "עובד" }));

    if (!pastShifts.length && !effectiveEmployees.length) {
      return showToast("err", "העלה קובץ Excel עם סידור קודם, או הוסף עובדים למערכת תחילה");
    }
    if (effectiveEmployees.length === 0) {
      return showToast("err", "לא זוהו עובדים — בדוק את רשימת העובדים בכלי הכוונון 🔧");
    }

    setGenerating(true); setDraftShifts(null);
    setGenerateStep("📊 מנתח דפוסי סידור...");

    try {
      // ── Step 1: upsert extracted employees to DB (before generation) ─────────
      if (extractedEmployees.length > 0) {
        setGenerateStep("💾 מסנכרן עובדים...");
        await persistConfirmedEmployees(extractedEmployees);
      }

      // ══════════════════════════════════════════════════════════════════════════
      // PATH A — LOCAL DUPLICATE (zero API, instant)
      // Condition: profiles learned from uploaded Excel exist.
      // Constraints (if any) are saved as "notes" on each shift row so the
      // manager can review them — no AI call is made.
      // Result: dates shifted to target week, done in <10ms in the browser.
      // ══════════════════════════════════════════════════════════════════════════
      if (employeeProfiles.length > 0) {
        setGenerateStep("⚡ שכפול תאריכים...");
        const schedule = duplicateScheduleLocally(
          employeeProfiles, weekStart, managerDepartment, constraints
        );
        if (!schedule.length) {
          showToast("err", "לא נמצאו ימי עבודה בפרופילים — בדוק את קובץ ה-Excel");
          setGenerating(false); setGenerateStep("");
          return;
        }
        setDraftShifts(schedule);
        setEngine("local-duplicate");
        showToast("ok", `⚡ שכפול מקומי · ${schedule.length} משמרות מוכנות לאישור`);
        setGenerating(false); setGenerateStep("");
        return; // ← no Edge Function called at all
      }

      // ══════════════════════════════════════════════════════════════════════════
      // PATH B — AI (Gemini via Edge Function)
      // Cases:
      //   B1. profiles + constraints → AI applies constraint exceptions to known schedule
      //   B2. no profiles at all     → AI generates creative schedule from scratch
      // ══════════════════════════════════════════════════════════════════════════
      setGenerateStep("🤖 שולח ל-AI...");

      const { data, error } = await supabase.functions.invoke("generate-schedule", {
        body: {
          pastShifts,
          employees:       effectiveEmployees,
          employeeProfiles,
          constraints,
          weekStart,
          department:      managerDepartment,
          managerId:       user?.id,
          excelSchema:     detectedSchema,
        },
      });

      // Edge Function always returns HTTP 200 — real errors are in data.error
      if (error) throw new Error("שגיאת רשת — לא ניתן להגיע לשרת: " + error.message);
      if (!data?.ok) {
        const raw = data?.error ?? "יצירת הסידור נכשלה";
        if (raw.includes("quota") || raw.includes("429"))
          throw new Error("⚠️ מכסת Gemini מוצתה. העלה Excel עם הסידור הקודם לייצור ללא AI.");
        if (raw.includes("schedule_empty"))
          throw new Error("⚠️ ה-AI לא הצליח לייצר משמרות — נסה לפרט יותר באילוצים.");
        throw new Error(raw);
      }

      setDraftShifts(data.schedule || []);
      setEngine(data.engine || null);
      if (!data.schedule?.length) {
        showToast("err", "ה-AI לא החזיר משמרות — נסה לחדד אילוצים");
      } else {
        const engineLabel = {
          "local-duplicate": "⚡ שכפול מקומי",
          "gemini":          "✨ Gemini",
        }[data.engine] ?? data.engine;
        showToast("ok", `${engineLabel} · ${data.schedule.length} משמרות מוכנות לאישור`);
      }
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
      console.error("[ShiftGenerator] generate error:", e);
    }
    setGenerating(false); setGenerateStep("");
  };

  const removeRow = (i) => setDraftShifts((s) => s.filter((_, idx) => idx !== i));

  // approve() — only INSERT into `shifts` on explicit manager confirmation
  const approve = async () => {
    if (!draftShifts?.length) return;
    setApproving(true);
    try {
      // Build DB rows — use exact column names from schema
      const rows = draftShifts.map((s, i) => ({
        id:             Date.now() + i,
        "employeeName": s.employeeName,          // quoted camelCase — matches DB column
        department:     managerDepartment || s.department || "כללי",
        date:           s.date,
        start:          s.start,
        "end":          s.end,                   // "end" is reserved word — use quotes
        station:        s.station ?? "",
        status:         s.status || "עתידי",
        notes:          s.notes ?? "",
      }));

      // Upsert in batches of 50 to avoid payload limits
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await supabase.from("shifts").upsert(rows.slice(i, i + BATCH));
        if (error) throw new Error(error.message);
      }

      // ── WhatsApp staff notifications ──────────────────────────────────────
      try {
        const byEmp = {};
        rows.forEach((r) => {
          const empPhone = employees.find(e => e.name === r["employeeName"])?.phone;
          const key = r["employeeName"];
          (byEmp[key] ||= []).push({ ...r, phone: empPhone ?? "" });
        });
        await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "shift_assignment", weekStart, assignments: byEmp },
        });
      } catch { /* non-critical */ }

      showToast("ok", `✅ ${rows.length} משמרות נשמרו בהצלחה!`);
      setDraftShifts(null);
      onApproved?.();
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + (e?.message ?? e));
    }
    setApproving(false);
  };

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* Department badge */}
      {managerDepartment && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "rgba(201,169,110,0.12)", border: "1px solid var(--gold)", borderRadius: 20,
          padding: "6px 14px", fontSize: 13, fontWeight: 700, color: "var(--gold-dark)" }}>
          {DEPT_LABEL[managerDepartment] || managerDepartment}
          <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>מחלקה נוכחית</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.7 }}>
            העלה סידור משמרות קודם, הוסף אילוצים בשפה חופשית, וה-AI ייצור סידור שבועי חדש ומאוזן.
            תוכל לעבור עליו ולאשר לפני שמירה.
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label>שבוע מתחיל בתאריך</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} dir="ltr" />
            </div>
            <div className="form-field">
              <label>סידור קודם (Excel/CSV)</label>
              <button onClick={() => inputRef.current?.click()}
                className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                {pastName || "📂 בחר קובץ"}
              </button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => parsePast(e.target.files?.[0])} />
            </div>
          </div>

          <div className="form-field" style={{ marginTop: 4 }}>
            <label>
              אילוצים והתאמות (טקסט חופשי)
              <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginRight: 6 }}>
                — ריק = שכפול מיידי ⚡ · עם טקסט = AI מטפל בחריגות ✨
              </span>
            </label>
            <textarea rows={4} value={constraints} onChange={(e) => setConstraints(e.target.value)}
              placeholder='ריק = שכפול אוטומטי של כל המשמרות לשבוע הבא (מהיר, ללא AI). עם אילוצים: "אביב בחופשה ביום שלישי", "החלף בין בני ליוסי", "דנה רק בקרים"'
              style={{ resize: "vertical" }} />
          </div>

          {/* ── Detected employees — admin-editable chips ─────────────────── */}
          {extractedEmployees.length > 0 && (
            <div style={{
              marginTop: 16,
              background: "rgba(26,122,74,0.07)",
              border: "1px solid rgba(26,122,74,0.25)",
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1A7A4A" }}>
                  🧠 עובדים שזוהו ({extractedEmployees.length})
                  {detectedSchema && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginRight: 8 }}>
                      · פורמט: {detectedSchema}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowAdminTuner(t => !t)}
                  style={{ fontSize: 12, color: "#c09a2f", background: "none", border: "1px solid #c09a2f",
                    borderRadius: 14, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                  🔧 {showAdminTuner ? "סגור כוונון" : "כוונן"}
                </button>
              </div>

              {/* Chips — click × to remove (add to blacklist) */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {extractedEmployees.map(name => (
                  <div key={name} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: "white", border: "1px solid #c8e6c9",
                    borderRadius: 20, padding: "3px 8px 3px 12px",
                    fontSize: 13, color: "#1a3a2a",
                  }}>
                    <span>{name}</span>
                    <button
                      title="הסר מרשימת עובדים"
                      onClick={() => {
                        const updated = new Set(customBlacklist);
                        updated.add(name.toLowerCase());
                        saveCustomBlacklist(updated);
                        setCustomBlacklist(updated);
                        setExtractedEmployees(prev => prev.filter(n => n !== name));
                        showToast("ok", `"${name}" הוסר — לא יזוהה בפעם הבאה`);
                      }}
                      style={{ background: "#f8d7da", border: "none", borderRadius: "50%",
                        width: 18, height: 18, cursor: "pointer", fontSize: 11,
                        color: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* ── Admin tuner panel ──────────────────────────────────────── */}
              {showAdminTuner && (
                <div style={{
                  marginTop: 14, padding: 14,
                  background: "rgba(255,255,255,0.7)", border: "1px solid #e0e0e0",
                  borderRadius: 10,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 10 }}>
                    🔧 כלי כוונון — מה המערכת צריכה לסנן?
                  </div>

                  {/* Current blacklist */}
                  {customBlacklist.size > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                        ❌ מסוננים כרגע (לא ייחשבו כעובדים):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {[...customBlacklist].map(word => (
                          <div key={word} style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "#fef2f2", border: "1px solid #fca5a5",
                            borderRadius: 14, padding: "2px 8px 2px 10px", fontSize: 12, color: "#b91c1c",
                          }}>
                            <span>{word}</span>
                            <button
                              onClick={() => {
                                const updated = new Set(customBlacklist);
                                updated.delete(word);
                                saveCustomBlacklist(updated);
                                setCustomBlacklist(updated);
                                // Re-extract with updated blacklist
                                if (pastShifts.length) {
                                  const { names } = extractNamesFromExcel(pastShifts, updated);
                                  setExtractedEmployees(names);
                                }
                              }}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#b91c1c" }}>
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add to blacklist */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <input
                      value={newBlackWord}
                      onChange={e => setNewBlackWord(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && newBlackWord.trim()) {
                          const updated = new Set(customBlacklist);
                          updated.add(newBlackWord.trim().toLowerCase());
                          saveCustomBlacklist(updated);
                          setCustomBlacklist(updated);
                          setNewBlackWord("");
                          if (pastShifts.length) {
                            const { names } = extractNamesFromExcel(pastShifts, updated);
                            setExtractedEmployees(names);
                          }
                          showToast("ok", `"${newBlackWord}" נוסף לרשימת הסינון`);
                        }
                      }}
                      placeholder='הקלד ערך לסנן (Enter לשמירה) — למשל: "toilet" / "day off"'
                      style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", fontSize: 13 }}
                    />
                    <button
                      onClick={() => {
                        if (!newBlackWord.trim()) return;
                        const updated = new Set(customBlacklist);
                        updated.add(newBlackWord.trim().toLowerCase());
                        saveCustomBlacklist(updated);
                        setCustomBlacklist(updated);
                        setNewBlackWord("");
                        if (pastShifts.length) {
                          const { names } = extractNamesFromExcel(pastShifts, updated);
                          setExtractedEmployees(names);
                        }
                        showToast("ok", `"${newBlackWord}" נוסף לרשימת הסינון`);
                      }}
                      style={{ background: "#c09a2f", color: "white", border: "none",
                        borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      + הוסף
                    </button>
                  </div>

                  {/* Manual add employee */}
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, marginTop: 4, borderTop: "1px solid #eee", paddingTop: 10 }}>
                    ✏️ הוסף עובד ידנית שלא זוהה (Enter לשמירה):
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      placeholder="שם עובד חדש..."
                      id="manual-emp-input"
                      style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", fontSize: 13 }}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const n = e.target.value.trim();
                          if (!n) return;
                          // Add to whitelist so it's never filtered
                          const wl = loadCustomWhitelist();
                          wl.add(n.toLowerCase());
                          saveCustomWhitelist(wl);
                          setExtractedEmployees(prev => prev.includes(n) ? prev : [...prev, n]);
                          e.target.value = "";
                          showToast("ok", `"${n}" נוסף לרשימה`);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById("manual-emp-input");
                        const n = input?.value.trim();
                        if (!n) return;
                        const wl = loadCustomWhitelist();
                        wl.add(n.toLowerCase());
                        saveCustomWhitelist(wl);
                        setExtractedEmployees(prev => prev.includes(n) ? prev : [...prev, n]);
                        input.value = "";
                        showToast("ok", `"${n}" נוסף לרשימה`);
                      }}
                      style={{ background: "#1A7A4A", color: "white", border: "none",
                        borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      + עובד
                    </button>
                  </div>

                  {/* Re-analyze button */}
                  <button
                    onClick={() => {
                      if (!pastShifts.length) return showToast("err", "טען קובץ Excel תחילה");
                      const { names, schemaLabel } = extractNamesFromExcel(pastShifts, customBlacklist);
                      setDetectedSchema(schemaLabel);
                      setExtractedEmployees(names);
                      showToast("ok", `🔄 נותח מחדש — ${names.length} עובדים זוהו`);
                    }}
                    style={{ marginTop: 10, fontSize: 12, color: "#555", background: "#f5f5f5",
                      border: "1px solid #ddd", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
                    🔄 נתח מחדש את הקובץ
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Learned employees panel */}
          {learnedSummary.length > 0 && (
            <div style={{
              marginTop: 16,
              background: "rgba(26,122,74,0.07)",
              border: "1px solid rgba(26,122,74,0.25)",
              borderRadius: 10,
              padding: "12px 16px",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1A7A4A", marginBottom: 8 }}>
                🧠 למדתי מהסידור הקודם — {learnedSummary.length} עובדים
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {learnedSummary.map(({ name, shifts }) => (
                  <div key={name} style={{
                    background: "white", border: "1px solid #ddd", borderRadius: 20,
                    padding: "3px 10px", fontSize: 12, color: "#333",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ color: "#888", fontSize: 11 }}>{shifts.slice(0, 3).join(", ")}{shifts.length > 3 ? "..." : ""}</span>
                  </div>
                ))}
              </div>
              {employees.length === 0 && extractedEmployees.length > 0 && (
                <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>
                  ⚠️ עובדים ייובאו מהאקסל (טבלת employees ריקה)
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {employees.length > 0 ? employees.length : extractedEmployees.length} עובדים
              {extractedEmployees.length > 0 && employees.length === 0 && (
                <span style={{ color: "#c09a2f" }}> (מהאקסל)</span>
              )}
              {" "}· {pastShifts.length} שורות עבר
            </div>
            <button className="btn btn-primary" disabled={generating} onClick={generate}
              style={{ minWidth: 200, opacity: generating ? 0.7 : 1, position: "relative" }}>
              {generating ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <span style={{
                    width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "white", borderRadius: "50%",
                    animation: "spin 0.7s linear infinite", display: "inline-block",
                  }} />
                  {generateStep || "מייצר סידור..."}
                </span>
              ) : (
                // Show mode indicator on button so manager knows what will happen
                employeeProfiles.length > 0
                  ? constraints.trim()
                    ? "⚡ שכפול + אילוצים כהערות"
                    : "⚡ שכפול אוטומטי לשבוע הבא"
                  : "🪄 צור סידור חכם עם AI"
              )}
            </button>
          </div>
        </div>
      </div>

      {draftShifts && (
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-title">
              טיוטה לאישור · {draftShifts.length} משמרות
              {engine && <span style={{ marginRight: 8, fontSize: 11, color: "var(--text-muted)" }}>
                {engine === "gemini" ? "✨ Gemini" : "🤖 Claude"}
              </span>}
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>עובד</th><th>תחנה / משמרת</th><th>תאריך</th>
                    <th>התחלה</th><th>סיום</th><th>מחלקה</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {draftShifts.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 700 }}>{s.employeeName}</td>
                      <td style={{ fontSize: 12, color: "#555" }}>{s.station || s.department || "—"}</td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{s.date}</td>
                      <td style={{ direction: "ltr", color: "#1A7A4A", fontWeight: 600 }}>{s.start}</td>
                      <td style={{ direction: "ltr", color: "#C0392B", fontWeight: 600 }}>{s.end}</td>
                      <td style={{ fontSize: 12, color: "#888" }}>{s.department}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => removeRow(i)}
                          style={{ background: "#FFF0EE", color: "#C0392B" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setDraftShifts(null)}>ביטול טיוטה</button>
              <button className="btn btn-primary" disabled={approving} onClick={approve}
                style={{ minWidth: 180, opacity: approving ? 0.6 : 1 }}>
                {approving ? "שומר..." : "✓ אשר ושמור + שלח לצוות"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
