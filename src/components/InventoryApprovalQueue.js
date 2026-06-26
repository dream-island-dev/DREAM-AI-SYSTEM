// src/components/InventoryApprovalQueue.js
// Inventory Smart-Intake Module — manager triage queue for daily employee
// submissions (inventory_submissions/inventory_counts, migration 090).
// Nothing an employee submits is "live" until handled here — same
// pending/approve/edit/reject convention as RequestsBoard.js (guest_alerts)
// and SpaStagingPanel.js, and the same card layout already approved in the
// feature's mockup (pending/approved/rejected all stay visible, never
// silently removed — CLAUDE.md §0.2 Disable-Don't-Hide).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

const STATUS_META = {
  pending:  { label: "ממתין",        bg: "#FAEEDA", color: "#633806" },
  approved: { label: "עודכן במערכת", bg: "#EAF3DE", color: "#27500A" },
  rejected: { label: "נדחה",         bg: "#FCEBEB", color: "#791F1F" },
};

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export default function InventoryApprovalQueue({ user }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null);

  // Edit-before-approve / reject modal
  const [modal, setModal] = useState(null); // { submission, mode: "edit"|"reject" } | null
  const [editCounts, setEditCounts] = useState([]); // local editable copy while mode==="edit"
  const [rejectNote, setRejectNote] = useState("");
  const [saving, setSaving] = useState(false);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchSubmissions = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_submissions")
      .select("*, inventory_counts(id, item_id, counted_quantity, restock_suggested, inventory_items(item_name, unit, par_level))")
      .order("submitted_at", { ascending: false });
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setSubmissions(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const sorted = [...submissions].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return new Date(b.submitted_at) - new Date(a.submitted_at);
  });
  const visible = showResolved ? sorted : sorted.filter((s) => s.status === "pending");
  const pendingCount = submissions.filter((s) => s.status === "pending").length;

  const approve = async (submission) => {
    const patch = { status: "approved", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("inventory_submissions").update(patch).eq("id", submission.id);
    if (error) { showToast("err", "שגיאה באישור: " + error.message); return; }
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, ...patch } : s)));
    showToast("ok", "✅ עודכן במערכת");
  };

  const openEdit = (submission) => {
    setEditCounts(submission.inventory_counts.map((c) => ({ ...c })));
    setModal({ submission, mode: "edit" });
  };
  const openReject = (submission) => { setRejectNote(""); setModal({ submission, mode: "reject" }); };
  const closeModal = () => { if (!saving) { setModal(null); setEditCounts([]); setRejectNote(""); } };

  const setEditQty = (countId, qty) => {
    setEditCounts((prev) => prev.map((c) => {
      if (c.id !== countId) return c;
      const parLevel = c.inventory_items?.par_level;
      const num = qty === "" ? "" : Number(qty);
      return {
        ...c,
        counted_quantity: qty,
        restock_suggested: (parLevel == null || num === "" || Number.isNaN(num)) ? c.restock_suggested : parLevel - num,
      };
    }));
  };

  const confirmEditAndApprove = async () => {
    if (!modal) return;
    setSaving(true);
    try {
      for (const c of editCounts) {
        const { error } = await supabase
          .from("inventory_counts")
          .update({ counted_quantity: Number(c.counted_quantity), restock_suggested: c.restock_suggested })
          .eq("id", c.id);
        if (error) throw new Error(error.message);
      }
      const patch = { status: "approved", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), review_note: "נערך ע״י המנהל לפני אישור" };
      const { error: subErr } = await supabase.from("inventory_submissions").update(patch).eq("id", modal.submission.id);
      if (subErr) throw new Error(subErr.message);

      showToast("ok", "✅ עודכן במערכת עם השינויים");
      setModal(null);
      await fetchSubmissions();
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmReject = async () => {
    if (!modal) return;
    setSaving(true);
    const patch = { status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), review_note: rejectNote.trim() || null };
    const { error } = await supabase.from("inventory_submissions").update(patch).eq("id", modal.submission.id);
    setSaving(false);
    if (error) { showToast("err", "שגיאה בדחייה: " + error.message); return; }
    setSubmissions((prev) => prev.map((s) => (s.id === modal.submission.id ? { ...s, ...patch } : s)));
    showToast("ok", "סומן כנדחה");
    setModal(null);
  };

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

      {/* Edit-before-approve / reject modal */}
      {modal && (
        <div onClick={closeModal} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card-bg)", borderRadius: 12, padding: 24, maxWidth: 460, width: "90%", maxHeight: "80vh", overflowY: "auto", direction: "rtl" }}>
            <h3 style={{ margin: "0 0 14px", color: "var(--gold-dark)" }}>
              {modal.mode === "edit" ? "✏️ ערוך לפני אישור" : "✕ דחה דיווח"} — {modal.submission.location_name}
            </h3>

            {modal.mode === "edit" ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {editCounts.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{c.inventory_items?.item_name ?? "—"}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="number"
                          value={c.counted_quantity}
                          onChange={(e) => setEditQty(c.id, e.target.value)}
                          style={{ width: 70, fontFamily: "Heebo, sans-serif" }}
                        />
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.inventory_items?.unit ?? ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={closeModal} disabled={saving} style={{ background: "var(--ivory)" }}>ביטול</button>
                  <button className="btn btn-sm" disabled={saving} onClick={confirmEditAndApprove} style={{ background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700 }}>
                    {saving ? "שומר…" : "✓ אשר עם השינויים"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  סיבת דחייה (אופציונלי)
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  placeholder="לדוגמה: כמויות לא הגיוניות, יש לספור מחדש..."
                  style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: 10, fontFamily: "Heebo, sans-serif", fontSize: 13, resize: "vertical", boxSizing: "border-box", marginBottom: 16 }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={closeModal} disabled={saving} style={{ background: "var(--ivory)" }}>ביטול</button>
                  <button className="btn btn-sm" disabled={saving} onClick={confirmReject} style={{ background: "#FFF0EE", color: "#C0392B", fontWeight: 700 }}>
                    {saving ? "שומר…" : "✕ דחה"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{pendingCount} ממתינים לאישור</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} style={{ accentColor: "var(--gold)" }} />
            הצג גם טופלו
          </label>
          <button className="btn btn-ghost btn-sm" onClick={fetchSubmissions} disabled={loading}>{loading ? "..." : "↺ רענון"}</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          {showResolved ? "אין דיווחים עדיין." : "אין דיווחים ממתינים 🎉"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((s) => {
            const meta = STATUS_META[s.status] ?? { label: `⚠ ${s.status}`, bg: "#F5F5F5", color: "#888" };
            const isExpanded = expandedId === s.id;
            const items = s.inventory_counts ?? [];
            return (
              <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", background: "var(--card-bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>📦 {s.location_name}</div>
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, cursor: "pointer" }}
                    >
                      {fmtTimestamp(s.submitted_at)} · {items.length} פריטים עודכנו {isExpanded ? "▲" : "▼"}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color, padding: "4px 10px", borderRadius: 20 }}>
                    {meta.label}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ background: "var(--ivory)", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12 }}>
                    {items.map((c) => (
                      <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                        <span>{c.inventory_items?.item_name ?? "—"}</span>
                        <span>
                          {c.counted_quantity} {c.inventory_items?.unit ?? ""}
                          {c.restock_suggested != null && <span style={{ color: "var(--gold-dark)", marginRight: 8 }}>· להשלים: {c.restock_suggested}</span>}
                        </span>
                      </div>
                    ))}
                    {s.review_note && <div style={{ marginTop: 6, color: "var(--text-muted)" }}>📝 {s.review_note}</div>}
                  </div>
                )}

                {s.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => approve(s)} style={{ border: "none", borderRadius: 7, background: "var(--gold)", color: "#0F0F0F", padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      אשר ועדכן
                    </button>
                    <button onClick={() => openEdit(s)} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      ערוך לפני אישור
                    </button>
                    <button onClick={() => openReject(s)} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#791F1F", cursor: "pointer", fontFamily: "Heebo, sans-serif" }}>
                      דחה
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
