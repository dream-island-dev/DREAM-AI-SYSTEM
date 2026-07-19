// src/components/VoucherExceptionsBoard.js
// Voucher Reconciliation Engine (Yelena) — triage table over
// voucher_reconciliation_results (migration 091). Every provider/EasyGo row
// from a run is represented here, including clean matches (FAIL VISIBLE,
// CLAUDE.md §0.3) — this board filters matched rows out of the default view
// rather than the query ever excluding them. review_status is a human
// decision layer independent of the machine's match_status (same
// pending/approved/rejected convention as InventoryApprovalQueue.js/
// RequestsBoard.js) — updated directly via the Supabase client, no RPC needed
// since this is a plain status flag, not a multi-table write.

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { packageTypesMatchEnhanced, packageMatchGroup, PACKAGE_GROUP_LABEL_HE } from "../utils/voucherPackageMatch";

const MATCH_META = {
  missing_in_provider: { label: "⚠️ הוזמן באיזיגו — לא מומש",     color: "#791F1F", bg: "#FCEBEB", priority: 1 },
  over_redemption:   { label: "🟡 מימוש מעבר לכמות באיזיגו",  color: "#92400E", bg: "#FEF3C7", priority: 2 },
  package_mismatch:    { label: "🟠 חבילה לא תואמת",              color: "#7A4A06", bg: "#FFF3DC", priority: 3 },
  duplicate_match:     { label: "🟣 לא ניתן לבחור שובר",          color: "#5B21B6", bg: "#F3E8FF", priority: 4 },
  missing_in_easygo:   { label: "🔵 מומש בספק — לא באיזיגו",      color: "#1E40AF", bg: "#E8F0FE", priority: 5 },
  unparseable:         { label: "⚪ לא ניתן לפענוח",               color: "#4B5563", bg: "#F3F4F6", priority: 6 },
  matched:             { label: "🟢 תואם",                        color: "#27500A", bg: "#EAF3DE", priority: 7 },
};

const REVIEW_META = {
  pending:  { label: "ממתין", bg: "#FAEEDA", color: "#633806" },
  approved: { label: "אושר",  bg: "#EAF3DE", color: "#27500A" },
  rejected: { label: "נדחה",  bg: "#FCEBEB", color: "#791F1F" },
  resolved: { label: "טופל",  bg: "#E8F0FE", color: "#1E40AF" },
};

const DEFAULT_MATCH_FILTER = new Set([
  "missing_in_provider", "over_redemption", "package_mismatch",
  "duplicate_match", "missing_in_easygo", "unparseable",
]);

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("he-IL");
}
function fmtMoney(n) {
  return n == null ? "—" : `₪${Number(n).toLocaleString("he-IL")}`;
}
function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export default function VoucherExceptionsBoard({ user, filterRunId = null, runStats = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matchFilter, setMatchFilter] = useState(DEFAULT_MATCH_FILTER);
  const [showResolved, setShowResolved] = useState(false);
  const [runFilter, setRunFilter] = useState(filterRunId);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (filterRunId) setRunFilter(filterRunId);
  }, [filterRunId]);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchRows = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("voucher_reconciliation_results")
      .select(`
        id, reconciliation_run_id, match_status, match_basis, discrepancy_note, review_status, reviewed_at, review_note, created_at,
        voucher_provider_reports ( voucher_number, guest_name, package_type, amount, purchase_date, source_file_name ),
        voucher_easygo_records ( voucher_number, guest_name, phone, order_number, package_type, amount, arrival_date, source_file_name ),
        voucher_providers ( provider_name )
      `)
      .order("created_at", { ascending: false })
      .limit(500);
    if (runFilter) query = query.eq("reconciliation_run_id", runFilter);
    const { data, error } = await query;
    if (error) showToast("err", "שגיאה בטעינת דוח החריגים: " + error.message);
    else setRows(data ?? []);
    setLoading(false);
  }, [runFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const pendingCounts = useMemo(() => {
    const counts = {};
    for (const r of rows) {
      if (r.review_status !== "pending") continue;
      counts[r.match_status] = (counts[r.match_status] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    return rows
      .filter((r) => matchFilter.has(r.match_status))
      .filter((r) => showResolved || r.review_status === "pending")
      .sort((a, b) => {
        const pa = MATCH_META[a.match_status]?.priority ?? 9;
        const pb = MATCH_META[b.match_status]?.priority ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }, [rows, matchFilter, showResolved]);

  const toggleFilter = (key) => {
    setMatchFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const updateReviewStatus = async (row, newStatus) => {
    const patch = { review_status: newStatus, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("voucher_reconciliation_results").update(patch).eq("id", row.id);
    if (error) { showToast("err", "שגיאה בעדכון: " + error.message); return; }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    showToast("ok", `סומן כ"${REVIEW_META[newStatus]?.label ?? newStatus}"`);
  };

  const totalPending = rows.filter((r) => r.review_status === "pending").length;

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 13,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {Object.entries(MATCH_META).map(([key, meta]) => {
          const active = matchFilter.has(key);
          const count = pendingCounts[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              style={{
                border: `1.5px solid ${active ? meta.color : "var(--border)"}`,
                background: active ? meta.bg : "var(--card-bg)",
                color: active ? meta.color : "var(--text-muted)",
                borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700,
                cursor: "pointer", fontFamily: "Heebo, sans-serif", opacity: active ? 1 : 0.6,
              }}
            >
              {meta.label} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {runStats && runFilter && (
        <div style={{
          background: "rgba(201,169,110,0.12)", border: "1px solid var(--border)", borderRadius: 10,
          padding: "12px 14px", marginBottom: 16, fontSize: 12.5, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 800, color: "var(--gold-dark)", marginBottom: 4 }}>סיכום ריצה — אימות איזיגו מול ספק</div>
          <div>
            איזיגו: <strong>{runStats.easygo_rows ?? "—"}</strong> שוברים שהוזמנו
            {" · "}
            ספק: <strong>{runStats.provider_rows ?? "—"}</strong> שורות מימוש
            {(runStats.redemption_surplus ?? 0) > 0 && (
              <> · <strong style={{ color: "#92400E" }}>+{runStats.redemption_surplus} מימושים מעבר להזמנות</strong></>
            )}
          </div>
          <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
            🟢 {runStats.matched ?? 0} תואמים
            {(runStats.over_redemption ?? 0) > 0 && <> · 🟡 {runStats.over_redemption} מעבר לכמות באיזיגו</>}
            {(runStats.missing_in_provider ?? 0) > 0 && <> · ⚠️ {runStats.missing_in_provider} הוזמנו ולא מומשו</>}
            {(runStats.missing_in_easygo ?? 0) > 0 && <> · 🔵 {runStats.missing_in_easygo} מומשו בלי הזמנה באיזיגו</>}
          </div>
          {Array.isArray(runStats.quantity_audit) && runStats.quantity_issues > 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5 }}>
              <div style={{ fontWeight: 700, color: "#92400E", marginBottom: 4 }}>פערי כמות לפי שובר / חבילה:</div>
              {runStats.quantity_audit.filter((l) => l.status !== "ok").slice(0, 6).map((line) => (
                <div key={line.key} style={{ marginBottom: 3 }}>
                  {line.couponNo ? `שובר ${line.couponNo}` : `ת.ז. ${line.nationalId}`}
                  {" · "}
                  {PACKAGE_GROUP_LABEL_HE[line.packageGroup] || line.packageLabel?.slice(0, 40)}
                  {": "}
                  <strong>איזיגו {line.easygoCount}</strong>
                  {" / "}
                  <strong>ספק {line.providerCount}</strong>
                  {line.surplus > 0 && <span style={{ color: "#92400E" }}> (+{line.surplus})</span>}
                  {line.surplus < 0 && <span style={{ color: "#1E40AF" }}> ({line.surplus})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {totalPending} ממתינים לטיפול בסה״כ
          {runFilter && <span style={{ marginRight: 8 }}> · מסונן לריצה אחרונה</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {runFilter && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setRunFilter(null)}
              title="הצג את כל ריצות ההתאמה"
            >
              הצג הכל
            </button>
          )}
          <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} style={{ accentColor: "var(--gold)" }} />
            הצג גם טופלו
          </label>
          <button className="btn btn-ghost btn-sm" onClick={fetchRows} disabled={loading}>{loading ? "..." : "↺ רענון"}</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          {rows.length === 0 ? "אין עדיין תוצאות התאמה — בצע/י ייבוא בלשונית הקודמת." : "אין שורות בקטגוריות שנבחרו 🎉"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((r) => {
            const meta = MATCH_META[r.match_status] ?? { label: `⚠ ${r.match_status}`, color: "#888", bg: "#F5F5F5" };
            const review = REVIEW_META[r.review_status] ?? { label: `⚠ ${r.review_status}`, bg: "#F5F5F5", color: "#888" };
            const isExpanded = expandedId === r.id;
            const pv = r.voucher_provider_reports;
            const eg = r.voucher_easygo_records;
            const voucherNumber = eg?.voucher_number || pv?.voucher_number || "—";
            const guestName = eg?.guest_name || pv?.guest_name || "—";
            const providerName = r.voucher_providers?.provider_name || "—";

            const pkgMatch = pv?.package_type && eg?.package_type
              && packageTypesMatchEnhanced(pv.package_type, eg.package_type);
            const pkgGroup = packageMatchGroup(pv?.package_type || eg?.package_type);

            return (
              <div key={r.id} style={{ border: `1px solid ${meta.color}30`, borderRight: `4px solid ${meta.color}`, borderRadius: 10, padding: "14px 16px", background: "var(--card-bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      🧾 {voucherNumber} · {guestName} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {providerName}</span>
                    </div>
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, cursor: "pointer" }}
                    >
                      {fmtTimestamp(r.created_at)} {isExpanded ? "▲" : "▼"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color, padding: "4px 10px", borderRadius: 20 }}>
                      {meta.label}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: review.bg, color: review.color, padding: "4px 10px", borderRadius: 20 }}>
                      {review.label}
                    </span>
                  </div>
                </div>

                {r.discrepancy_note && (
                  <div style={{ fontSize: 12, color: meta.color, marginBottom: 8 }}>📝 {r.discrepancy_note}</div>
                )}

                {(pv?.package_type || eg?.package_type) && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
                    {pv?.package_type && <div>ספק: {pv.package_type}</div>}
                    {eg?.package_type && <div>איזיגו: {eg.package_type}</div>}
                    {pkgMatch && (
                      <div style={{ color: "#27500A", fontWeight: 700, marginTop: 4 }}>
                        ✓ אותה חבילה
                        {pkgGroup && PACKAGE_GROUP_LABEL_HE[pkgGroup] ? ` (${PACKAGE_GROUP_LABEL_HE[pkgGroup]})` : ""}
                      </div>
                    )}
                    {r.match_status === "over_redemption" && pkgMatch && (
                      <div style={{ color: "#92400E", marginTop: 2 }}>
                        מימוש נוסף מעבר למה שהוזמן באיזיגו לאותה חבילה
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && (
                  <div style={{ background: "var(--ivory)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>📄 דוח הספק</div>
                      {pv ? (
                        <>
                          <div>שובר: {pv.voucher_number || "—"}</div>
                          <div>חבילה: {pv.package_type || "—"}</div>
                          <div>סכום: {fmtMoney(pv.amount)}</div>
                          <div>תאריך רכישה: {fmtDate(pv.purchase_date)}</div>
                        </>
                      ) : <div style={{ color: "var(--text-muted)" }}>— לא נמצאה שורה תואמת —</div>}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>📄 דוח EasyGo</div>
                      {eg ? (
                        <>
                          <div>שובר: {eg.voucher_number || "—"}</div>
                          <div>חבילה: {eg.package_type || "—"}</div>
                          <div>סכום: {fmtMoney(eg.amount)}</div>
                          <div>טלפון: {eg.phone || "—"}</div>
                          <div>תאריך הגעה: {fmtDate(eg.arrival_date)}</div>
                        </>
                      ) : <div style={{ color: "var(--text-muted)" }}>— לא נמצאה שורה תואמת —</div>}
                    </div>
                    {r.review_note && (
                      <div style={{ gridColumn: "1 / -1", color: "var(--text-muted)", marginTop: 4 }}>📝 {r.review_note}</div>
                    )}
                  </div>
                )}

                {r.review_status === "pending" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => updateReviewStatus(r, "approved")} style={{ border: "none", borderRadius: 7, background: "#EAF3DE", color: "#27500A", padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      ✓ אישור
                    </button>
                    <button onClick={() => updateReviewStatus(r, "resolved")} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      ☑ טופל
                    </button>
                    <button onClick={() => updateReviewStatus(r, "rejected")} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#791F1F", cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      ✕ דחייה
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
