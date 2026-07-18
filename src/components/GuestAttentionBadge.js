// src/components/GuestAttentionBadge.js
// Red-alert entry point → full guest profile edit via parent (360 drawer + AddGuestModal).
import { useState } from "react";
import GuestProfileModal from "./GuestProfileModal";

const REASON_META = {
  date_change:      { icon: "🗓️", title: "ביקש/ה שינוי בתאריך הגעה — לחץ לפרופיל" },
  human_callback:   { icon: "📞", title: "ביקש/ה לדבר עם נציג — לחץ לפרופיל" },
  severe_complaint: { icon: "🚨", title: "ביקורת שלילית חריפה — דורש מנהל בדחיפות — לחץ לפרופיל" },
  financial_issue:  { icon: "💳", title: "בקשה כספית / בעיית חיוב — לחץ לפרופיל" },
  "בקשת טיפול בספא": { icon: "💆", title: "ביקש/ה טיפול בספא מהפורטל — לחץ לפרופיל" },
  "שאלה מורכבת לצוות": { icon: "🤔", title: "הבוט לא היה בטוח בתשובה — שאלה ממתינה למענה אנושי — לחץ לפרופיל" },
  fallback_no_match: { icon: "🔁", title: "הבוט לא מצא מענה מתאים והפנה לצוות הקבלה — לחץ לפרופיל" },
};

export default function GuestAttentionBadge({
  guest,
  onUpdated,
  showToast,
  onOpenDreamBotChat,
  onOpenFullEdit,
}) {
  const [open, setOpen] = useState(false);

  if (!guest?.requires_attention) return null;

  const reasonMeta = REASON_META[guest.attention_reason] ?? {
    icon: "🔴",
    title: "דורש טיפול — לחץ לפרופיל אורח",
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (onOpenFullEdit) {
      onOpenFullEdit(guest);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <span
        onClick={handleClick}
        title={reasonMeta.title}
        style={{ fontSize: 11, marginRight: 4, verticalAlign: "middle", cursor: "pointer" }}
      >
        {reasonMeta.icon}
      </span>
      {open && !onOpenFullEdit && (
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
