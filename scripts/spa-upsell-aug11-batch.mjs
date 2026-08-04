/**
 * One-shot: import Aug 11 day-pass guests + schedule spa_upsell_daypass via Meta for Aug 2 10:00 IL.
 *
 * Guest names/phones live in scripts/data/spa-upsell-aug11-guests.txt (gitignored — never commit real
 * guest PII in a tracked script). One name+phone per line, same format as before: "שם: טלפון".
 *
 * Safe by default: runs as a dry run (parses input, prints the SQL it *would* run, makes zero DB calls).
 * Pass --confirm to actually write to the linked project and schedule the real send.
 *
 * Run:
 *   node scripts/spa-upsell-aug11-batch.mjs            # dry run — no DB writes, no send
 *   node scripts/spa-upsell-aug11-batch.mjs --confirm   # live — writes guests/bookings, schedules send
 *
 * Uses: npx supabase db query --linked (no service role in .env required)
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ARRIVAL_DATE = "2026-08-11";
const SCHEDULE_DATE = "2026-08-02";
const SCHEDULE_TIME = "10:00";
const FORCE_CHANNEL = "meta_template";
const STAGE_KEY = "spa_upsell_daypass";
const DAY_PASS_ROOM = "בילוי יומי";

const GUEST_LIST_PATH = join(__dirname, "data", "spa-upsell-aug11-guests.txt");
const CONFIRMED = process.argv.includes("--confirm");

function loadRawLines() {
  try {
    return readFileSync(GUEST_LIST_PATH, "utf8").trim();
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(
        `Guest list not found at ${GUEST_LIST_PATH}. Create it (one "שם: טלפון" per line) — ` +
          `this file is gitignored on purpose, it is never checked into source control.`,
      );
    }
    throw err;
  }
}

const PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/;

function normalizeILPhone(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const hadPlus = /^\s*\+/.test(trimmed);
  let digits = trimmed.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `+972${digits}`;
  if ((hadPlus || digits.length >= 11) && digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

function parseRows(text) {
  const rows = [];
  const invalid = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(PHONE_RE);
    if (!m) {
      invalid.push(line);
      continue;
    }
    const phone = normalizeILPhone(m[1]);
    if (!phone) {
      invalid.push(line);
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    let name = line.slice(0, m.index).trim();
    name = name.replace(/^[:：\-–—|]+\s*/, "").replace(/\s*[:：\-–—|]+\s*$/, "").trim();
    rows.push({ name, phone });
  }
  return { rows, invalid };
}

function sqlEscape(str) {
  return String(str ?? "").replace(/'/g, "''");
}

function runQuery(sql) {
  const tmp = join(__dirname, ".tmp-spa-upsell-batch.sql");
  writeFileSync(tmp, sql, "utf8");
  try {
    const out = execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["supabase", "db", "query", "--linked", "-f", tmp, "-o", "json"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, shell: process.platform === "win32" },
    );
    return JSON.parse(out);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const { rows, invalid } = parseRows(loadRawLines());
  if (invalid.length) {
    console.warn("Invalid lines skipped:", invalid);
  }
  console.log(`Parsed ${rows.length} unique participants`);

  const guestValues = rows
    .map(
      (r) =>
        `('${sqlEscape(r.phone)}', '${sqlEscape(r.name)}', '${sqlEscape(ARRIVAL_DATE)}'::date, '${sqlEscape(ARRIVAL_DATE)}'::date, 'day_guest', '${sqlEscape(DAY_PASS_ROOM)}', 'pending', 1::smallint)`,
    )
    .join(",\n  ");

  const upsertGuestsSql = `
INSERT INTO public.guests (phone, name, arrival_date, departure_date, room_type, room, status, guest_index)
VALUES
  ${guestValues}
ON CONFLICT (phone, arrival_date, guest_index) DO UPDATE SET
  name = EXCLUDED.name,
  room_type = EXCLUDED.room_type,
  room = EXCLUDED.room,
  departure_date = EXCLUDED.departure_date,
  status = CASE WHEN guests.status = 'cancelled' THEN guests.status ELSE EXCLUDED.status END
RETURNING id, phone, name;
`;

  const bookingValues = rows
    .map(
      (r) =>
        `('${sqlEscape(r.phone.replace(/^\+/, ""))}', '${sqlEscape(r.name)}', '${sqlEscape(ARRIVAL_DATE)}'::date, 'expected', 1)`,
    )
    .join(",\n  ");

  const bookingsSql = `
INSERT INTO public.bookings (phone, guest_name, arrival_date, status, room_count)
VALUES
  ${bookingValues}
ON CONFLICT (phone, arrival_date) DO UPDATE SET
  guest_name = EXCLUDED.guest_name,
  status = EXCLUDED.status;
SELECT count(*)::int AS bookings_synced FROM public.bookings WHERE arrival_date = '${sqlEscape(ARRIVAL_DATE)}'::date;
`;

  if (!CONFIRMED) {
    console.log(
      "\n[DRY RUN] No DB calls made — nothing was written and no message was scheduled.\n" +
        "Review the SQL below, then re-run with --confirm to execute it against the linked project.\n",
    );
    console.log("--- guests upsert (would run against --linked) ---\n" + upsertGuestsSql);
    console.log("--- bookings upsert (would run against --linked) ---\n" + bookingsSql);
    console.log(
      `\nAfter that, would check eligibility among ${rows.length} phone numbers for arrival ${ARRIVAL_DATE}, ` +
        `then schedule stage '${STAGE_KEY}' for ${SCHEDULE_DATE} ${SCHEDULE_TIME} Asia/Jerusalem via ` +
        `force_channel='${FORCE_CHANNEL}' (eligibility depends on live data, so it is not previewed here).`,
    );
    return;
  }

  const guestResult = runQuery(upsertGuestsSql);
  const guestRows = guestResult?.rows ?? [];
  console.log(`Guests upserted/updated: ${guestRows.length}`);

  const bookingResult = runQuery(bookingsSql);
  console.log("Bookings sync:", bookingResult?.rows?.[0] ?? bookingResult);

  const phoneList = rows.map((r) => `'${sqlEscape(r.phone)}'`).join(", ");
  const eligibleSql = `
SELECT g.id, g.phone, g.name
FROM public.guests g
WHERE g.arrival_date = '${sqlEscape(ARRIVAL_DATE)}'::date
  AND g.phone IN (${phoneList})
  AND g.status <> 'cancelled'
  AND COALESCE(g.msg_spa_upsell_sent, false) = false
  AND g.room_type IN ('day_guest', 'premium_day_guest')
  AND g.room IS NOT NULL
  AND g.spa_time IS NULL
  AND (g.spa_date IS NULL OR g.spa_date <> g.arrival_date)
ORDER BY g.name;
`;

  const eligibleResult = runQuery(eligibleSql);
  const eligible = eligibleResult?.rows ?? [];
  console.log(`Eligible for spa upsell schedule: ${eligible.length}`);

  if (eligible.length === 0) {
    throw new Error("No eligible guests to schedule");
  }

  const tasks = eligible.map((g) => ({
    guest_id: g.id,
    stage_key: STAGE_KEY,
    schedule_date: SCHEDULE_DATE,
    schedule_time: SCHEDULE_TIME,
    force_channel: FORCE_CHANNEL,
  }));

  const tasksJson = JSON.stringify(tasks);
  const scheduleSql = `
SELECT public.staff_schedule_tasks_batch($spa_tasks$${tasksJson}$spa_tasks$::jsonb) AS scheduled_count;
`;

  const scheduleResult = runQuery(scheduleSql);
  const scheduled = scheduleResult?.rows?.[0]?.scheduled_count ?? scheduleResult?.rows?.[0];
  console.log(`Scheduled tasks: ${scheduled}`);

  const verifySql = `
SELECT count(*)::int AS pending_scheduled
FROM public.scheduled_tasks
WHERE stage_key = '${sqlEscape(STAGE_KEY)}'
  AND status = 'pending'
  AND staff_scheduled = true
  AND force_channel = '${sqlEscape(FORCE_CHANNEL)}'
  AND scheduled_for = (('${sqlEscape(SCHEDULE_DATE)}'::date + '${sqlEscape(SCHEDULE_TIME)}'::time) AT TIME ZONE 'Asia/Jerusalem');
`;

  const verify = runQuery(verifySql);
  console.log("Verify pending at slot:", verify?.rows?.[0] ?? verify);

  console.log("\nDone.", {
    arrivalDate: ARRIVAL_DATE,
    scheduleAt: `${SCHEDULE_DATE} ${SCHEDULE_TIME} Asia/Jerusalem`,
    channel: FORCE_CHANNEL,
    guests: guestRows.length,
    scheduled: eligible.length,
  });
}

main();
