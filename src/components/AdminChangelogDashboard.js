// Admin release timeline — fetches public/changelog.md (synced from docs/changelog.md).
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { formatChangelogDate, parseChangelog } from "../utils/parseChangelog";

const FILTERS = [
  { id: "7", label: "7 ימים", days: 7 },
  { id: "30", label: "30 יום", days: 30 },
  { id: "all", label: "הכל", days: null },
];

function scopeChips(scope) {
  return scope.split("+").map((s) => s.trim()).filter(Boolean);
}

export default function AdminChangelogDashboard() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("30");
  const [fetchedAt, setFetchedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${process.env.PUBLIC_URL || ""}/changelog.md?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setRaw(text);
      setFetchedAt(new Date());
    } catch (e) {
      setRaw("");
      setError(e?.message ?? "שגיאה בטעינת יומן השינויים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parsed = useMemo(() => parseChangelog(raw), [raw]);

  const filteredDates = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter);
    if (!f?.days) return parsed.dates;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - f.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return parsed.dates.filter((d) => d.date >= cutoffStr);
  }, [parsed.dates, filter]);

  return (
    <div style={{ padding: "0 0 60px", direction: "rtl", textAlign: "right" }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 16,
        marginBottom: 24,
      }}>
        <div>
          <h2 style={{
            fontFamily: "Playfair Display, serif",
            fontSize: 26,
            margin: "0 0 6px",
            color: "var(--gold-dark)",
          }}>
            📜 עדכוני מערכת
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            יומן שינויים פנימי — מסונכרן מ-docs/changelog.md
            {fetchedAt && (
              <span> · עודכן {fetchedAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
            )}
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
          {loading ? "טוען…" : "🔄 רענן"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              border: `1.5px solid ${filter === f.id ? "var(--gold-dark)" : "var(--border)"}`,
              background: filter === f.id ? "rgba(201,169,110,0.15)" : "var(--card-bg)",
              color: filter === f.id ? "var(--gold-dark)" : "inherit",
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{
          background: "#FFF0EE",
          border: "1px solid #C0392B",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 20,
          color: "#8A2C2C",
          fontSize: 13,
        }}>
          ⚠ טעינה נכשלה: {error}
        </div>
      )}

      {parsed.unparsed.length > 0 && (
        <div style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 20,
          fontSize: 12,
          color: "#92400E",
        }}>
          ⚠ {parsed.unparsed.length} שורות לא תואמות פורמט (מוצגות בתחתית)
        </div>
      )}

      {loading && !raw ? (
        <div style={{ color: "var(--text-muted)", padding: 24 }}>טוען יומן שינויים…</div>
      ) : filteredDates.length === 0 && !error ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
          אין עדכונים בטווח שנבחר
        </div>
      ) : (
        <div style={{ position: "relative", paddingRight: 28 }}>
          <div style={{
            position: "absolute",
            right: 10,
            top: 8,
            bottom: 8,
            width: 2,
            background: "var(--border)",
          }} />
          {filteredDates.map(({ date, entries }) => (
            <section key={date} style={{ marginBottom: 32, position: "relative" }}>
              <div style={{
                position: "absolute",
                right: 0,
                top: 4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "var(--gold)",
                border: "3px solid var(--ivory)",
                boxShadow: "0 0 0 2px var(--gold-dark)",
              }} />
              <div style={{ marginRight: 36 }}>
                <div style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: 20,
                  background: "rgba(201,169,110,0.2)",
                  color: "var(--gold-dark)",
                  fontWeight: 800,
                  fontSize: 13,
                  marginBottom: 12,
                }}>
                  {formatChangelogDate(date)}
                  <span style={{ fontWeight: 400, marginRight: 8, opacity: 0.7 }}>({date})</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {entries.map((entry, idx) => (
                    <article
                      key={`${date}-${idx}`}
                      className="card"
                      style={{ padding: "14px 18px", borderRight: "3px solid var(--gold)" }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {scopeChips(entry.scope).map((chip) => (
                          <span
                            key={chip}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 6,
                              background: "var(--ivory)",
                              border: "1px solid var(--border)",
                              color: "var(--text-muted)",
                              fontFamily: "monospace",
                              direction: "ltr",
                            }}
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                      <div
                        className="changelog-md"
                        style={{ fontSize: 14, lineHeight: 1.65, color: "#333" }}
                      >
                        <ReactMarkdown>{entry.description}</ReactMarkdown>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {parsed.unparsed.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text-muted)" }}>
            שורות לא מפורשות ({parsed.unparsed.length})
          </summary>
          <pre style={{
            marginTop: 12,
            padding: 16,
            background: "var(--ivory)",
            borderRadius: 8,
            fontSize: 11,
            overflow: "auto",
            direction: "ltr",
            textAlign: "left",
          }}>
            {parsed.unparsed.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
