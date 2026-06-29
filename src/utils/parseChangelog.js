// Parses docs/changelog.md pipe-separated entries into a timeline grouped by date.

const ENTRY_RE = /^(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+)$/;

/**
 * @param {string} rawMarkdown
 * @returns {{ dates: { date: string, entries: { scope: string, description: string, raw: string }[] }[], unparsed: string[] }}
 */
export function parseChangelog(rawMarkdown) {
  const byDate = new Map();
  const unparsed = [];

  for (const line of (rawMarkdown ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(ENTRY_RE);
    if (!match) {
      unparsed.push(trimmed);
      continue;
    }

    const [, date, scope, description] = match;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ scope: scope.trim(), description: description.trim(), raw: trimmed });
  }

  const dates = [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ date, entries }));

  return { dates, unparsed };
}

export function formatChangelogDate(isoDate) {
  try {
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
