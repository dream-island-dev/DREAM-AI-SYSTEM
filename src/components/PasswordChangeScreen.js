// src/components/PasswordChangeScreen.js
// Shown on first login when must_change_password === true.
// Forces user to set a personal password before entering the system.
import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function PasswordChangeScreen({ user, onComplete }) {
  const [newPass,   setNewPass]   = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [showPass,  setShowPass]  = useState(false);

  const BG    = "#1B3A32";
  const GOLD  = "#C9A25A";
  const LIGHT = "#F5F0E8";

  function validate() {
    if (newPass.length < 6)        return "הסיסמה חייבת להכיל לפחות 6 תווים";
    if (newPass === "1234")         return "לא ניתן להשתמש בסיסמה הזמנית כסיסמה קבועה";
    if (newPass !== confirm)        return "הסיסמאות אינן תואמות";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setSaving(true);
    try {
      // 1. Update password in Supabase Auth
      const { error: authErr } = await supabase.auth.updateUser({ password: newPass });
      if (authErr) throw authErr;

      // 2. Clear must_change_password flag in profiles
      await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id);

      // 3. Enter the system
      onComplete({ ...user, must_change_password: false });
    } catch (ex) {
      setError("שגיאה: " + (ex?.message ?? String(ex)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: BG,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Heebo, sans-serif", direction: "rtl", padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "rgba(255,255,255,0.05)",
        border: `1px solid rgba(201,162,90,0.3)`,
        borderRadius: 20, padding: "40px 36px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
      }}>

        {/* Logo / Brand */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏝️</div>
          <div style={{
            fontFamily: "Playfair Display, serif",
            fontSize: 22, fontWeight: 700,
            color: GOLD, letterSpacing: 1,
          }}>
            Dream Island
          </div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 4 }}>
            ברוך הבא, {user.name ?? user.email}
          </div>
        </div>

        {/* Title */}
        <div style={{
          color: LIGHT, fontSize: 16, fontWeight: 700,
          textAlign: "center", marginBottom: 6,
        }}>
          בחר סיסמה אישית
        </div>
        <div style={{
          color: "rgba(255,255,255,0.45)", fontSize: 12,
          textAlign: "center", marginBottom: 28,
        }}>
          הסיסמה הזמנית שלך היא זמנית בלבד — יש להחליפה לפני הכניסה
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* New password */}
          <div>
            <label style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              סיסמה חדשה
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="לפחות 6 תווים"
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "13px 44px 13px 16px",
                  background: "rgba(255,255,255,0.08)",
                  border: `1.5px solid ${error && newPass.length < 6 ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
                  borderRadius: 10, color: LIGHT, fontSize: 15,
                  fontFamily: "Heebo, sans-serif", outline: "none",
                  direction: "ltr", textAlign: "left",
                  transition: "border-color 0.2s",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(255,255,255,0.4)", fontSize: 16, padding: 0,
                }}
                tabIndex={-1}
              >
                {showPass ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Confirm */}
          <div>
            <label style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              אשר סיסמה
            </label>
            <input
              type={showPass ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="הזן שוב את הסיסמה"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "13px 16px",
                background: "rgba(255,255,255,0.08)",
                border: `1.5px solid ${error && newPass !== confirm ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
                borderRadius: 10, color: LIGHT, fontSize: 15,
                fontFamily: "Heebo, sans-serif", outline: "none",
                direction: "ltr", textAlign: "left",
                transition: "border-color 0.2s",
              }}
            />
          </div>

          {/* Validation hints */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { ok: newPass.length >= 6,          label: "לפחות 6 תווים" },
              { ok: newPass !== "1234" && newPass.length > 0, label: 'לא "1234"' },
              { ok: newPass === confirm && confirm.length > 0, label: "הסיסמאות תואמות" },
            ].map(({ ok, label }) => (
              <div key={label} style={{
                fontSize: 11, fontWeight: 600,
                color: ok ? "#4ade80" : "rgba(255,255,255,0.3)",
                display: "flex", alignItems: "center", gap: 6,
                transition: "color 0.2s",
              }}>
                {ok ? "✓" : "○"} {label}
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 8, padding: "10px 14px",
              color: "#fca5a5", fontSize: 13, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={saving || !newPass || !confirm}
            style={{
              marginTop: 8,
              width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
              background: saving || !newPass || !confirm
                ? "rgba(201,162,90,0.3)"
                : `linear-gradient(135deg, ${GOLD}, #A8843A)`,
              color: saving || !newPass || !confirm ? "rgba(255,255,255,0.4)" : "#1B3A32",
              fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 800,
              cursor: saving || !newPass || !confirm ? "not-allowed" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {saving ? "⏳ שומר..." : "כניסה למערכת →"}
          </button>
        </form>
      </div>
    </div>
  );
}
