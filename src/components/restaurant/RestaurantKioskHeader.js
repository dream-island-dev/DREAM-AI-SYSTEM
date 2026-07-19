// Branded header for Armonim kiosk — logo, session, tabs, end shift.

import { ARMONIM_KOSHER_LABEL, ARMONIM_LOGO_HEADER } from "../../data/armonimBrand";
import { useRestaurantShift } from "../../context/RestaurantShiftContext";
import { formatShiftStartedAt, sessionRoleLabel } from "../../utils/restaurantShiftSession";

export default function RestaurantKioskHeader({
  tabs,
  activeTab,
  onTabChange,
  onEndShift,
  endingShift,
}) {
  const { kioskUi, session, isShiftManager, activeOnFloor } = useRestaurantShift();

  return (
    <header className="armonim-kiosk-header">
      <img className="armonim-logo-header" src={ARMONIM_LOGO_HEADER} alt="ערמונים" />
      {kioskUi.kosher_badge && (
        <span className="armonim-kiosk-badge">{ARMONIM_KOSHER_LABEL}</span>
      )}
      <div className="armonim-kiosk-session">
        {session && (
          <>
            שלום, <strong>{session.displayName}</strong>
            {" · "}{sessionRoleLabel(session.sessionRole)}
            {session.startedAt && (
              <> · מ-{formatShiftStartedAt(session.startedAt)}</>
            )}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`armonim-kiosk-tab${activeTab === id ? " is-active" : ""}`}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="armonim-kiosk-btn-ghost"
        disabled={endingShift}
        onClick={onEndShift}
      >
        {endingShift ? "…" : "סיום משמרת"}
      </button>
      {isShiftManager && activeOnFloor.length > 1 && (
        <div className="armonim-floor-panel" style={{ width: "100%", marginTop: 4 }}>
          <strong>על הרצפה:</strong>{" "}
          {activeOnFloor.map((s) => s.display_name).join(" · ")}
        </div>
      )}
    </header>
  );
}
