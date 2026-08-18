import { createRequire } from "module";
import { readFileSync } from "fs";
import {
  parseEzgoActivitiesReport,
  repairEzgoCsvText,
} from "../src/utils/ezgoSpaActivitiesParser.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const path = process.argv[2];
const text = repairEzgoCsvText(readFileSync(path, "utf8"));
const wb = XLSX.read(text, { type: "string", raw: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const { rows, skippedCancelled } = parseEzgoActivitiesReport(rawRows);

const therapists = new Map();
const rooms = new Map();
const dates = new Map();
let noPhone = 0;
let noRoom = 0;
let noTherapist = 0;
let noGuest = 0;
const warn = new Map();

for (const r of rows) {
  if (r.therapist_name) therapists.set(r.therapist_name, (therapists.get(r.therapist_name) || 0) + 1);
  else noTherapist++;
  if (r.room_raw) rooms.set(r.room_raw, (rooms.get(r.room_raw) || 0) + 1);
  else noRoom++;
  const d = r.appointment_date || "?";
  dates.set(d, (dates.get(d) || 0) + 1);
  if (!r.phone) noPhone++;
  if (!r.guest_name) noGuest++;
  for (const w of r.warnings || []) warn.set(w, (warn.get(w) || 0) + 1);
}

function top(map, n = 40) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

console.log(JSON.stringify({
  rawRows: rawRows.length,
  parsed: rows.length,
  skippedCancelled,
  noPhone,
  noRoom,
  noTherapist,
  noGuest,
  uniqueTherapists: therapists.size,
  uniqueRooms: rooms.size,
  dateCount: dates.size,
  dateMin: [...dates.keys()].sort()[0],
  dateMax: [...dates.keys()].sort().at(-1),
  warnings: Object.fromEntries(warn),
  rooms: top(rooms, 30),
  therapists: top(therapists, 80),
  sample: rows.find((r) => r.therapist_name && r.guest_name && r.room_raw && r.phone) || null,
}, null, 2));
