// Armonim shift gate — pick name + role before entering the kiosk board.

import { useState } from "react";
import { ARMONIM_LOGO_FULL } from "../../data/armonimBrand";
import { useRestaurantShift } from "../../context/RestaurantShiftContext";
import { sessionRoleLabel } from "../../utils/restaurantShiftSession";

export default function RestaurantShiftGate() {
  const { kioskUi, roster, startShift } = useRestaurantShift();
  const [step, setStep] = useState("name");
  const [picked, setPicked] = useState(null);
  const [customName, setCustomName] = useState("");
  const [role, setRole] = useState("waiter");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const displayName = picked?.display_name ?? customName.trim();

  const canPickManager = picked?.can_be_shift_manager ?? true;

  const goRole = () => {
    if (!displayName) {
      setError("נא לבחור שם מהרשימה או להקליד");
      return;
    }
    setError("");
    setRole(picked?.can_be_shift_manager ? "shift_manager" : "waiter");
    setStep("role");
  };

  const submit = async () => {
    if (!displayName) return;
    setSaving(true);
    setError("");
    try {
      await startShift({
        displayName,
        sessionRole: role,
        staffId: picked?.id ?? null,
        shiftManagerPin: pin,
      });
    } catch (e) {
      setError(e?.message ?? "שגיאה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="armonim-shift-gate">
      <div className="armonim-shift-gate-card">
        <img
          className="armonim-logo-welcome"
          src={ARMONIM_LOGO_FULL}
          alt="מסעדת ערמונים"
        />
        <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "var(--armonim-brown-dark)" }}>
          {kioskUi.welcome_line}
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666", lineHeight: 1.5 }}>
          {kioskUi.evening_hours_line}
        </p>

        {step === "name" && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 12, textAlign: "right" }}>מי במשמרת?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {roster.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="armonim-name-btn"
                  style={{
                    borderColor: picked?.id === r.id ? "var(--armonim-teal)" : undefined,
                    background: picked?.id === r.id ? "rgba(0,128,128,0.08)" : undefined,
                  }}
                  onClick={() => { setPicked(r); setCustomName(""); }}
                >
                  {r.display_name}
                  {r.can_be_shift_manager ? " · מנהל משמרת" : ""}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customName}
              onChange={(e) => { setCustomName(e.target.value); setPicked(null); }}
              placeholder="או הקלד/י שם…"
              style={{
                width: "100%", boxSizing: "border-box", padding: "12px 14px",
                borderRadius: 10, border: "1.5px solid var(--armonim-border)",
                fontFamily: "Heebo, sans-serif", fontSize: 15, marginBottom: 12,
                textAlign: "right",
              }}
            />
            {error && <p style={{ color: "#C0392B", fontSize: 13, marginBottom: 10 }}>{error}</p>}
            <button type="button" className="armonim-primary-btn" onClick={goRole}>
              המשך ←
            </button>
          </>
        )}

        {step === "role" && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>
              שלום, <strong>{displayName}</strong>
            </p>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>מה התפקיד במשמרת?</p>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <button
                type="button"
                className={`armonim-role-btn${role === "waiter" ? " is-selected" : ""}`}
                onClick={() => setRole("waiter")}
              >
                🍽️ מלצר/ית
              </button>
              {canPickManager && (
                <button
                  type="button"
                  className={`armonim-role-btn${role === "shift_manager" ? " is-selected" : ""}`}
                  onClick={() => setRole("shift_manager")}
                >
                  👔 מנהל משמרת
                </button>
              )}
            </div>
            {role === "shift_manager" && kioskUi.shift_manager_pin && (
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="קוד מנהל משמרת"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "12px 14px",
                  borderRadius: 10, border: "1.5px solid var(--armonim-border)",
                  fontFamily: "Heebo, sans-serif", fontSize: 15, marginBottom: 12,
                  textAlign: "center", letterSpacing: 4,
                }}
              />
            )}
            {error && <p style={{ color: "#C0392B", fontSize: 13, marginBottom: 10 }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="armonim-name-btn"
                style={{ flex: 1 }}
                onClick={() => setStep("name")}
              >
                → חזור
              </button>
              <button
                type="button"
                className="armonim-primary-btn"
                style={{ flex: 2 }}
                disabled={saving}
                onClick={submit}
              >
                {saving ? "פותח משמרת…" : "התחל משמרת ✨"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#999", marginTop: 14 }}>
              תפקיד נבחר: {sessionRoleLabel(role)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
