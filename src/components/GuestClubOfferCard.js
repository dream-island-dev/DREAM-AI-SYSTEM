// src/components/GuestClubOfferCard.js
// Shared club opt-in card — portal thank-you (2-step: offer → profile) + staff preview.

import React, { useState } from "react";
import { normalizeGuestClubUi, DEFAULT_GUEST_CLUB_UI } from "../utils/guestClubUi";

const XOS_GOLD = "#D4AF37";
const XOS_TEXT = "#F8FAFC";
const XOS_MUTED = "#94A3B8";
const XOS_BORDER = "rgba(255,255,255,0.14)";

const inputStyle = {
  width: "100%",
  maxWidth: 320,
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${XOS_BORDER}`,
  background: "rgba(0,0,0,0.25)",
  color: XOS_TEXT,
  fontSize: 14,
  fontFamily: "inherit",
  textAlign: "right",
};

/**
 * @param {object} props
 * @param {object} [props.ui]
 * @param {boolean} [props.previewOnly]
 * @param {boolean} [props.busy]
 * @param {(action: 'join'|'decline', profile?: object) => void} [props.onAction]
 * @param {'active'|null} [props.status]
 * @param {boolean} [props.showWaHint]
 */
export default function GuestClubOfferCard({
  ui,
  previewOnly = false,
  busy = false,
  onAction,
  status = null,
  showWaHint = false,
}) {
  const club = normalizeGuestClubUi(ui ?? DEFAULT_GUEST_CLUB_UI);
  const [step, setStep] = useState("offer");
  const [hasPartner, setHasPartner] = useState(false);
  const [guestBirthday, setGuestBirthday] = useState("");
  const [partnerBirthday, setPartnerBirthday] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [formError, setFormError] = useState("");

  if (status === "active") {
    return (
      <div style={{ marginTop: 12, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: XOS_GOLD, lineHeight: 1.7 }}>
          {club.joined_confirm}
        </div>
        {showWaHint && club.wa_review_hint && (
          <div style={{ fontSize: 11, color: XOS_MUTED, marginTop: 10, lineHeight: 1.6 }}>
            {club.wa_review_hint}
          </div>
        )}
      </div>
    );
  }

  function handleContinue() {
    setFormError("");
    setStep("profile");
  }

  function handleSubmitProfile() {
    if (previewOnly) return;
    if (!guestBirthday.trim()) {
      setFormError("נא למלא תאריך לידה כדי להצטרף ולקבל הטבות");
      return;
    }
    setFormError("");
    onAction?.("join", {
      guest_birthday: guestBirthday,
      partner_birthday: hasPartner && partnerBirthday.trim() ? partnerBirthday : null,
      wedding_anniversary: anniversary.trim() || null,
    });
  }

  if (step === "profile" && !previewOnly) {
    return (
      <div style={{
        marginTop: 4, padding: "16px 14px", borderRadius: 14,
        border: `1px solid ${XOS_BORDER}`, background: "rgba(212,175,55,0.08)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: XOS_GOLD, marginBottom: 8 }}>
          {club.profile_step_title}
        </div>
        <div style={{ fontSize: 12, color: XOS_MUTED, lineHeight: 1.6, marginBottom: 14 }}>
          {club.benefits_hint}
        </div>

        <label style={{ display: "block", textAlign: "right", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: XOS_TEXT, marginBottom: 4, fontWeight: 600 }}>
            {club.guest_birthday_label}
          </div>
          <div style={{ fontSize: 11, color: XOS_MUTED, marginBottom: 6 }}>{club.guest_birthday_hint}</div>
          <input
            type="date"
            value={guestBirthday}
            onChange={(e) => setGuestBirthday(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>

        <label style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          marginBottom: hasPartner ? 10 : 14, cursor: busy ? "default" : "pointer",
          fontSize: 13, color: XOS_TEXT,
        }}>
          <span>{club.partner_toggle_label}</span>
          <input
            type="checkbox"
            checked={hasPartner}
            onChange={(e) => {
              setHasPartner(e.target.checked);
              if (!e.target.checked) setPartnerBirthday("");
            }}
            disabled={busy}
          />
        </label>

        {hasPartner && (
          <label style={{ display: "block", textAlign: "right", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: XOS_TEXT, marginBottom: 6, fontWeight: 600 }}>
              {club.partner_birthday_label} <span style={{ color: XOS_MUTED, fontWeight: 400 }}>{club.optional_suffix}</span>
            </div>
            <input
              type="date"
              value={partnerBirthday}
              onChange={(e) => setPartnerBirthday(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
          </label>
        )}

        <label style={{ display: "block", textAlign: "right", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: XOS_TEXT, marginBottom: 6, fontWeight: 600 }}>
            {club.anniversary_label} <span style={{ color: XOS_MUTED, fontWeight: 400 }}>{club.optional_suffix}</span>
          </div>
          <input
            type="date"
            value={anniversary}
            onChange={(e) => setAnniversary(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>

        {club.consent_line && (
          <div style={{ fontSize: 11, color: XOS_MUTED, lineHeight: 1.6, marginBottom: 12, textAlign: "right" }}>
            {club.consent_line}
          </div>
        )}

        {formError && (
          <div style={{ fontSize: 12, color: "#FCA5A5", marginBottom: 10 }}>{formError}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmitProfile}
            style={{
              width: "100%", maxWidth: 320, padding: "12px 18px", borderRadius: 14, border: "none",
              background: `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`,
              color: "#0f172a", fontSize: 14, fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
              fontFamily: "inherit", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "שומרים..." : club.submit_profile_label}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep("offer")}
            style={{
              width: "100%", maxWidth: 320, padding: "8px 18px", borderRadius: 14,
              border: "none", background: "transparent", color: XOS_MUTED,
              fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            חזרה
          </button>
        </div>
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
      <div style={{ fontSize: 13, color: XOS_TEXT, lineHeight: 1.7, marginBottom: 8 }}>
        {club.body}
      </div>
      <div style={{ fontSize: 12, color: XOS_MUTED, lineHeight: 1.6, marginBottom: 14 }}>
        {club.benefits_hint}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={previewOnly || busy}
          onClick={() => (previewOnly ? undefined : handleContinue())}
          style={{
            width: "100%", maxWidth: 320, padding: "12px 18px", borderRadius: 14, border: "none",
            background: `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`,
            color: "#0f172a", fontSize: 14, fontWeight: 700,
            cursor: previewOnly || busy ? "default" : "pointer",
            fontFamily: "inherit", opacity: busy ? 0.7 : 1,
          }}
        >
          {previewOnly ? club.join_label : club.continue_label}
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
