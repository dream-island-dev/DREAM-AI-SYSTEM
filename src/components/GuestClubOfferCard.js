// src/components/GuestClubOfferCard.js
// Shared club opt-in card — portal thank-you + staff preview.

import React from "react";
import { normalizeGuestClubUi, DEFAULT_GUEST_CLUB_UI } from "../utils/guestClubUi";

const XOS_GOLD = "#D4AF37";
const XOS_TEXT = "#F8FAFC";
const XOS_MUTED = "#94A3B8";
const XOS_BORDER = "rgba(255,255,255,0.14)";

/**
 * @param {object} props
 * @param {object} [props.ui]
 * @param {boolean} [props.previewOnly]
 * @param {boolean} [props.busy]
 * @param {(action: 'join'|'decline') => void} [props.onAction]
 * @param {'active'|null} [props.status] — when active, show joined confirm only
 */
export default function GuestClubOfferCard({
  ui,
  previewOnly = false,
  busy = false,
  onAction,
  status = null,
}) {
  const club = normalizeGuestClubUi(ui ?? DEFAULT_GUEST_CLUB_UI);

  if (status === "active") {
    return (
      <div style={{ marginTop: 12, fontSize: 13, color: XOS_GOLD, lineHeight: 1.7, textAlign: "center" }}>
        {club.joined_confirm}
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 4, padding: "16px 14px", borderRadius: 14,
      border: `1px solid ${XOS_BORDER}`, background: "rgba(212,175,55,0.08)",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: XOS_GOLD, marginBottom: 8 }}>
        {club.title}
      </div>
      <div style={{ fontSize: 13, color: XOS_TEXT, lineHeight: 1.7, marginBottom: 14 }}>
        {club.body}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={previewOnly || busy}
          onClick={() => onAction?.("join")}
          style={{
            width: "100%", maxWidth: 320, padding: "12px 18px", borderRadius: 14, border: "none",
            background: `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`,
            color: "#0f172a", fontSize: 14, fontWeight: 700,
            cursor: previewOnly || busy ? "default" : "pointer",
            fontFamily: "inherit", opacity: busy ? 0.7 : 1,
          }}
        >
          {club.join_label}
        </button>
        <button
          type="button"
          disabled={previewOnly || busy}
          onClick={() => onAction?.("decline")}
          style={{
            width: "100%", maxWidth: 320, padding: "10px 18px", borderRadius: 14,
            border: `1px solid ${XOS_BORDER}`, background: "transparent",
            color: XOS_MUTED, fontSize: 13, fontWeight: 600,
            cursor: previewOnly || busy ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {club.decline_label}
        </button>
      </div>
    </div>
  );
}
