// src/components/InventoryLinksPanel.js
// Inventory Smart-Intake Module — manage the no-login daily-fill magic links
// (inventory_portal_links, migration 090). Same security model and clipboard-
// copy pattern as CustomerProfilePane.js's Guest Portal link button: the
// token itself IS the auth, navigator.clipboard with a window.prompt fallback
// (Clipboard API can fail on permissions / non-secure context — FAIL VISIBLE,
// never a silent no-op click).
//
// "צור קישור חדש" (rotate) never mutates an existing token in place — it
// deactivates the old row and inserts a fresh one, so the link history stays
// auditable instead of being silently overwritten.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

export default function InventoryLinksPanel() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newLocationName, setNewLocationName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadLinks = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_portal_links")
      .select("id, token, location_name, is_active, created_at")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) showToast("err", "שגיאה בטעינת קישורים: " + error.message);
    setLinks(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const createLink = async () => {
    if (!supabase || !newLocationName.trim()) return;
    setCreating(true);
    try {
      const { error } = await supabase
        .from("inventory_portal_links")
        .insert({ location_name: newLocationName.trim() });
      if (error) throw new Error(error.message);
      setNewLocationName("");
      showToast("ok", "✅ קישור נוצר");
      await loadLinks();
    } catch (e) {
      showToast("err", "שגיאה ביצירת קישור: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const rotateLink = async (link) => {
    if (!supabase) return;
    try {
      const { error: deactivateErr } = await supabase
        .from("inventory_portal_links")
        .update({ is_active: false })
        .eq("id", link.id);
      if (deactivateErr) throw new Error(deactivateErr.message);

      const { error: insertErr } = await supabase
        .from("inventory_portal_links")
        .insert({ location_name: link.location_name });
      if (insertErr) throw new Error(insertErr.message);

      showToast("ok", "✅ קישור חדש נוצר — הקישור הקודם הושבת");
      await loadLinks();
    } catch (e) {
      showToast("err", "שגיאה ברענון קישור: " + e.message);
    }
  };

  async function copyLink(link) {
    const url = `${window.location.origin}/inv/${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2200);
    } catch {
      window.prompt("העתיקו את הקישור למילוי מלאי:", url);
    }
  }

  function shareOnWhatsApp(link) {
    const url = `${window.location.origin}/inv/${link.token}`;
    const text = encodeURIComponent(`קישור למילוי מלאי יומי — ${link.location_name}\n${url}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10, fontWeight: 700,
          fontSize: 13, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-dark)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
        יצירת קישור
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={newLocationName}
          onChange={(e) => setNewLocationName(e.target.value)}
          placeholder="שם מחסן/מיקום, לדוגמה: מחסן ראשי"
          onKeyDown={(e) => e.key === "Enter" && createLink()}
          style={{ flex: 1, fontFamily: "Heebo, sans-serif" }}
        />
        <button
          onClick={createLink}
          disabled={creating || !newLocationName.trim()}
          style={{
            border: "none", borderRadius: 8, padding: "10px 18px",
            background: creating || !newLocationName.trim() ? "var(--border)" : "var(--gold)",
            color: "#0F0F0F", fontWeight: 800, fontSize: 13, cursor: creating ? "not-allowed" : "pointer",
            fontFamily: "Heebo, sans-serif", whiteSpace: "nowrap",
          }}
        >
          + יצירת קישור
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>טוען...</div>
      ) : links.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-muted)", fontSize: 13 }}>
          אין עדיין קישורים — צרו קישור ראשון מעל.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {links.map((link) => (
            <div
              key={link.id}
              style={{
                border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
                background: link.is_active ? "var(--card-bg)" : "var(--ivory)",
                opacity: link.is_active ? 1 : 0.65,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: link.is_active ? 10 : 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {link.is_active ? "📦" : "🔒"} {link.location_name}
                  {!link.is_active && <span style={{ marginRight: 6, fontSize: 11, color: "var(--text-muted)" }}> · הושבת</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(link.created_at).toLocaleDateString("he-IL")}
                </div>
              </div>

              {link.is_active && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => copyLink(link)}
                    style={{
                      border: `1px solid ${copiedId === link.id ? "#1A7A4A" : "var(--gold)"}`,
                      borderRadius: 7, background: copiedId === link.id ? "#E8F5EF" : "var(--ivory)",
                      color: copiedId === link.id ? "#1A7A4A" : "var(--gold-dark)",
                      padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif",
                    }}
                  >
                    {copiedId === link.id ? "✓ הועתק" : "🔗 העתק קישור"}
                  </button>
                  <button
                    onClick={() => shareOnWhatsApp(link)}
                    style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif" }}
                  >
                    📤 שלח ב-WhatsApp
                  </button>
                  <button
                    onClick={() => rotateLink(link)}
                    style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--card-bg)", padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif", color: "var(--text-muted)" }}
                  >
                    🔄 צור קישור חדש
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
