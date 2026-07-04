// Shared spa date+time formatting for portal, WhatsApp placeholders, and automation.
// spa_time = HH:MM (24h); spa_date = YYYY-MM-DD (optional — when absent, messages stay time-only).

export function normalizeHmTime(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || s === "null" || s === "undefined") return "";
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function normalizeSpaDateYmd(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function formatSpaDateHe(ymd: string): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function hasSpaBooking(spaDate: unknown, spaTime: unknown): boolean {
  return !!(normalizeHmTime(spaTime) || normalizeSpaDateYmd(spaDate));
}

/** Hebrew when-phrase: "ב-05/07/2026 בשעה 14:00" | "בשעה 14:00" | "ב-05/07/2026" */
export function buildSpaWhenPhrase(spaDate: unknown, spaTime: unknown): string {
  const time = normalizeHmTime(spaTime);
  const dateHe = formatSpaDateHe(normalizeSpaDateYmd(spaDate));
  if (dateHe && time) return `ב-${dateHe} בשעה ${time}`;
  if (time) return `בשעה ${time}`;
  if (dateHe) return `ב-${dateHe}`;
  return "";
}

export function formatSpaScheduleDisplay(spaDate: unknown, spaTime: unknown): string | null {
  const time = normalizeHmTime(spaTime);
  const dateHe = formatSpaDateHe(normalizeSpaDateYmd(spaDate));
  if (dateHe && time) return `${dateHe} · ${time}`;
  if (time) return time;
  if (dateHe) return dateHe;
  return null;
}

export function buildSpaLine(spaDate: unknown, spaTime: unknown): string {
  const when = buildSpaWhenPhrase(spaDate, spaTime);
  return when ? `מתואם לכם טיפול בספא ${when}. בנוסף, ` : "";
}

export function buildOptionalSpaText(spaDate: unknown, spaTime: unknown): string {
  const when = buildSpaWhenPhrase(spaDate, spaTime);
  return when ? `מתואם לכם טיפול בספא ${when}.\n` : "";
}

export function buildSpaTimeSentence(spaDate: unknown, spaTime: unknown): string {
  const when = buildSpaWhenPhrase(spaDate, spaTime);
  return when ? `הטיפול שלכם בספא מתואם ${when}.` : "";
}

export function buildSpaSentence(spaDate: unknown, spaTime: unknown): string {
  const when = buildSpaWhenPhrase(spaDate, spaTime);
  return when ? `הטיפול שלך בספא מתוכנן ${when}.` : "נשמח לעמוד לרשותך בכל שאלה.";
}
