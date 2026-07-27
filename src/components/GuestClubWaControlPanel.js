/**
 * ACC control panel — Guest Club WA invite + suite departure survey fallback.
 */

import { useState } from "react";
import {
  DEFAULT_GUEST_CLUB_WA_SETTINGS,
  GUEST_CLUB_WA_SETTINGS_KEY,
  normalizeGuestClubWaSettings,
  serializeGuestClubWaSettings,
} from "../utils/guestClubWaSettings";

export default function GuestClubWaControlPanel({
  settings,
  onSettingsChange,
  onSaveSettings,
  saving,
  checkoutDelayMinutes,
  onCheckoutDelayChange,
  onCheckoutDelaySave,
}) {
  const s = normalizeGuestClubWaSettings(settings ?? DEFAULT_GUEST_CLUB_WA_SETTINGS);
  const [draftDelay, setDraftDelay] = useState(String(s.wa_invite_delay_minutes));
  const [draftFallbackTime, setDraftFallbackTime] = useState(s.departure_fallback_time);
  const [draftCheckoutDelay, setDraftCheckoutDelay] = useState(String(checkoutDelayMinutes ?? 15));

  function patch(partial) {
    const next = normalizeGuestClubWaSettings({ ...s, ...partial });
    onSettingsChange(next);
    return next;
  }

  function commitWaDelay() {
    const n = parseInt(draftDelay, 10);
    const next = patch({ wa_invite_delay_minutes: Number.isFinite(n) ? Math.min(Math.max(n, 0), 60) : 3 });
    onSaveSettings?.(next);
  }

  function commitFallbackTime() {
    const next = patch({ departure_fallback_time: draftFallbackTime || "19:00" });
    onSaveSettings?.(next);
  }

  function commitCheckoutDelay() {
    onCheckoutDelayChange?.(draftCheckoutDelay);
    onCheckoutDelaySave?.();
  }

  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12, marginBottom: 16,
      background: "rgba(201,169,110,0.08)", border: "1px solid var(--gold)",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
        🌴 מועדון לקוחות + משוב אחרי עזיבה
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, marginBottom: 14 }}>
        זרימה מומלצת: הצטרפות למועדון בפורטל (ברירת מחדל) → גוגל ב-WA אחרי join/decline.
        WA עם קישור #club נשאר גיבוי למי שלא עבר בפורטל.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={s.wa_invite_enabled}
            onChange={(e) => {
              const next = patch({ wa_invite_enabled: e.target.checked });
              onSaveSettings?.(next);
            }}
          />
          שלח הצעת מועדון בוואטסאפ (אחרי ביקורת חיובית)
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={s.portal_offer_enabled}
            onChange={(e) => {
              const next = patch({ portal_offer_enabled: e.target.checked });
              onSaveSettings?.(next);
            }}
          />
          הצג מועדון בפורטל (ערוץ ראשי — מומלץ דלוק)
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>השהייה אחרי ביקורת גוגל → מועדון</span>
          <input
            type="number"
            min={0}
            max={60}
            value={draftDelay}
            style={{ width: 72 }}
            onChange={(e) => setDraftDelay(e.target.value)}
            onBlur={commitWaDelay}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>דקות</span>
        </div>

        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(3,105,161,0.06)", border: "1px solid #93C5FD",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0369A1", marginBottom: 8 }}>
            🏨 סוויטות — fallback סקר ביום עזיבה (בלי Co מחדרנות)
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={s.departure_fallback_enabled}
              onChange={(e) => {
                const next = patch({ departure_fallback_enabled: e.target.checked });
                onSaveSettings?.(next);
              }}
            />
            שלח סקר משוב אוטומטית ביום העזיבה
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>משעה (ישראל)</span>
            <input
              type="time"
              value={draftFallbackTime}
              style={{ width: 110 }}
              onChange={(e) => setDraftFallbackTime(e.target.value)}
              onBlur={commitFallbackTime}
            />
          </div>
        </div>

        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(201,169,110,0.1)", border: "1px solid var(--gold)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            ⏱ השהייה אחרי Co מקבוצת חדרנות (סקר סוויטות)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              type="number"
              min={0}
              max={120}
              step={5}
              value={draftCheckoutDelay}
              style={{ width: 80 }}
              onChange={(e) => setDraftCheckoutDelay(e.target.value)}
              onBlur={commitCheckoutDelay}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>דקות</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.55 }}>
        מפתח הגדרות: <code>{GUEST_CLUB_WA_SETTINGS_KEY}</code>
        {" · "}
        עריכת נוסח מועדון: שלב «הצעת מועדון לקוחות ב-WA» למטה או ניהול חכם → סקרים.
      </div>
    </div>
  );
}

export { GUEST_CLUB_WA_SETTINGS_KEY, serializeGuestClubWaSettings };
