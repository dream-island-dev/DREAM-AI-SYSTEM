// src/components/GuestAttentionBadge.js
// Red-alert entry point → Smart Guest Profile modal (§0.5 single guests row).
import { useState } from "react";
import GuestProfileModal from "./GuestProfileModal";

const REASON_META = {
  date_change:      { icon: "🗓️", title: "ביקש/ה שינוי בתאריך הגעה — לחץ לפרופיל" },
  human_callback:   { icon: "📞", title: "ביקש/ה לדבר עם נציג — לחץ לפרופיל" },
  severe_complaint: { icon: "🚨", title: "ביקורת שלילית חריפה — דורש מנהל בדחיפות — לחץ לפרופיל" },
  financial_issue:  { icon: "💳", title: "בקשה כספית / בעיית חיוב — לחץ לפרופיל" },
  "בקשת טיפול בספא": { icon: "💆", title: "ביקש/ה טיפול בספא מהפורטל — לחץ לפרופיל" },
};

export default function GuestAttentionBadge({ guest, onUpdated, showToast, onOpenDreamBotChat }) {
  const [open, setOpen] = useState(false);

  if (!guest?.requires_attention) return null;

  const reasonMeta = REASON_META[guest.attention_reason] ?? {
    icon: "🔴",
    title: "דורש טיפול — לחץ לפרופיל אורח",
  };

  return (
    <>
      <span
        onClick={() => setOpen(true)}
        title={reasonMeta.title}
        style={{ fontSize: 11, marginRight: 4, verticalAlign: "middle", cursor: "pointer" }}
      >
        {reasonMeta.icon}
      </span>
      {open && (
        <GuestProfileModal
          guest={guest}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
          showToast={showToast}
          showMarkHandled
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}
    </>
  );
}
