// Armonim shift gate — type your name + pick role (one screen).

import { useEffect, useMemo, useRef, useState } from "react";
import { ARMONIM_LOGO_FULL } from "../../data/armonimBrand";
import { useRestaurantShift } from "../../context/RestaurantShiftContext";
import {
  isGenericRosterPlaceholder,
  readRecentShiftNames,
  rememberRecentShiftName,
  sessionRoleLabel,
} from "../../utils/restaurantShiftSession";

const SHIFT_ROLES = [
  { id: "hostess", label: "🛎️ מארחת", hint: "תיאום שעות ארוחה ושיחות עם אורחים" },
  { id: "shift_manager", label: "👔 מנהל משמרת", hint: "פיקוח על משמרת והזמנות" },
  { id: "waiter", label: "🍽️ מלצר/ית", hint: "לקיחת הזמנות מהאורחים" },
];

function NameChip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      className="armonim-name-btn"
      onClick={onClick}
      style={{
        padding: "10px 14px",
        minHeight: 44,
        borderColor: selected ? "var(--armonim-teal)" : undefined,
        background: selected ? "rgba(0,128,128,0.08)" : undefined,
      }}
    >
      {label}
    </button>
  );
}

export default function RestaurantShiftGate() {
  const { kioskUi, roster, startShift } = useRestaurantShift();
  const nameInputRef = useRef(null);
  const [name, setName] = useState("");
  const [staffId, setStaffId] = useState(null);
  const [role, setRole] = useState("hostess");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [recentNames, setRecentNames] = useState(() => readRecentShiftNames());

  const rosterQuickPicks = useMemo(
    () => (roster ?? []).filter((r) => !isGenericRosterPlaceholder(r.display_name)),
    [roster],
  );

  const displayName = name.trim();
  const pickedRoster = rosterQuickPicks.find((r) => r.display_name === displayName) ?? null;
  const canPickManager = pickedRoster ? pickedRoster.can_be_shift_manager : true;

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!canPickManager && role === "shift_manager") {
      setRole("waiter");
    }
  }, [canPickManager, role]);

  const pickName = (nextName, nextStaffId = null) => {
    setName(nextName);
    setStaffId(nextStaffId);
    setError("");
    const match = rosterQuickPicks.find((r) => r.display_name === nextName);
    if (match?.can_be_shift_manager) setRole("shift_manager");
  };

  const submit = async () => {
    if (!displayName) {
      setError("חובה להקליד שם — כך נתעד מי ביצע כל פעולה במשמרת");
      nameInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await startShift({
        displayName,
        sessionRole: role,
        staffId,
        shiftManagerPin: pin,
      });
      rememberRecentShiftName(displayName);
      setRecentNames(readRecentShiftNames());
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

        <label
          htmlFor="armonim-shift-name"
          style={{ display: "block", fontWeight: 800, marginBottom: 4, textAlign: "right", fontSize: 15 }}
        >
          מה השם שלך? <span style={{ color: "#C0392B" }}>*</span>
        </label>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px", textAlign: "right", lineHeight: 1.45 }}>
          חובה בכל משמרת — לתיעוד הזמנות, וואטסאפ ושינויים
        </p>
        <input
          id="armonim-shift-name"
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setStaffId(null);
            setError("");
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && displayName) submit(); }}
          placeholder="לדוגמה: דנה, יוסי…"
          autoComplete="name"
          style={{
            width: "100%", boxSizing: "border-box", padding: "16px 14px",
            borderRadius: 12, border: `2px solid ${displayName ? "var(--armonim-teal)" : "var(--armonim-border)"}`,
            fontFamily: "Heebo, sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 10,
            textAlign: "right",
          }}
        />

        {(recentNames.length > 0 || rosterQuickPicks.length > 0) && (
          <div style={{ marginBottom: 16 }}>
            {recentNames.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#888", margin: "0 0 6px", textAlign: "right" }}>
                  שמות אחרונים
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: rosterQuickPicks.length ? 10 : 0 }}>
                  {recentNames.map((n) => (
                    <NameChip
                      key={`recent-${n}`}
                      label={n}
                      selected={displayName === n}
                      onClick={() => pickName(n)}
                    />
                  ))}
                </div>
              </>
            )}
            {rosterQuickPicks.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#888", margin: "0 0 6px", textAlign: "right" }}>
                  מהצוות
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {rosterQuickPicks.map((r) => (
                    <NameChip
                      key={r.id}
                      label={r.display_name}
                      selected={displayName === r.display_name}
                      onClick={() => pickName(r.display_name, r.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <p style={{ fontSize: 13, fontWeight: 700, color: "#666", marginBottom: 8, textAlign: "right" }}>
          תפקיד במשמרת <span style={{ color: "#C0392B" }}>*</span>
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {SHIFT_ROLES.map((opt) => {
            if (opt.id === "shift_manager" && !canPickManager) return null;
            const selected = role === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`armonim-role-btn${selected ? " is-selected" : ""}`}
                onClick={() => setRole(opt.id)}
                style={{ width: "100%", textAlign: "right", minHeight: 52 }}
              >
                <div style={{ fontWeight: 800 }}>{opt.label}</div>
                <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.75, marginTop: 2 }}>{opt.hint}</div>
              </button>
            );
          })}
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

        <button
          type="button"
          className="armonim-primary-btn"
          disabled={saving || !displayName}
          onClick={submit}
        >
          {saving ? "פותח משמרת…" : "התחל משמרת ✨"}
        </button>

        {displayName && (
          <p style={{ fontSize: 11, color: "#999", marginTop: 14 }}>
            {displayName} · {sessionRoleLabel(role)}
          </p>
        )}
      </div>
    </div>
  );
}
