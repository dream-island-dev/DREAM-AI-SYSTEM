/** Mirror of _shared/oritThreadAnalysis.ts — strip third-person Orit lines from ack drafts. */
export function sanitizeOritAckDraft(text) {
  const lines = String(text || "").split(/\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/מנהלת\s+שירות\s+לאורח.*אורית\s+חלפון.*(תבחן|תיצור|תצור|תחזור)/i.test(t)) return false;
    if (/אורית\s+חלפון.*(תבחן|תיצור|תצור|תחזור|תיצמד)/i.test(t)) return false;
    if (/^מנהלת\s+שירות\s+לאורח,\s*אורית\s+חלפון,/i.test(t)) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
