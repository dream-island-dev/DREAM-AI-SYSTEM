// Restaurant staff kiosk — לוח מסעדה + שיחות WA (ללא שאר XOS).

import { useState, useCallback } from "react";
import RestaurantDinnerBoard from "./RestaurantDinnerBoard";
import WhatsAppInbox from "./WhatsAppInbox";
import { RESTAURANT_FOCUS_NAV_IDS } from "../utils/auth";

const TABS = [
  { id: "restaurant_dinner_board", icon: "🍽️", label: "לוח מסעדה" },
  { id: "wa_inbox", icon: "💬", label: "שיחות" },
];

export default function RestaurantKioskShell({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("restaurant_dinner_board");
  const [inboxFocus, setInboxFocus] = useState(null);
  const [inboxReturn, setInboxReturn] = useState(null);
  const [returnGuestId, setReturnGuestId] = useState(null);

  const openDreamBotChat = useCallback(({
    phone,
    guestName,
    returnPage,
    returnGuestId: guestId,
    returnPageLabel,
  }) => {
    setInboxFocus({
      phone,
      guestName: guestName ?? null,
      inboxChannel: null,
    });
    if (returnPage && RESTAURANT_FOCUS_NAV_IDS.has(returnPage)) {
      setInboxReturn({ page: returnPage, label: returnPageLabel ?? null });
      setReturnGuestId(guestId ?? null);
    } else {
      setInboxReturn(null);
      setReturnGuestId(null);
    }
    setActiveTab("wa_inbox");
  }, []);

  const returnFromInbox = useCallback(() => {
    setActiveTab("restaurant_dinner_board");
    setInboxFocus(null);
    setInboxReturn(null);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--ivory, #F5F0E8)",
      display: "flex",
      flexDirection: "column",
    }}>
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "#fff",
        borderBottom: "1px solid var(--border, #ddd)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#9A7209", marginLeft: 4 }}>
          🍽️ מסעדה
        </div>
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          {TABS.map(({ id, icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: activeTab === id ? "2px solid #A8843A" : "1px solid var(--border, #ddd)",
                background: activeTab === id ? "rgba(201,169,110,0.15)" : "#fff",
                fontFamily: "Heebo, sans-serif",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 12px",
              background: "#fff",
              cursor: "pointer",
              fontFamily: "Heebo, sans-serif",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            יציאה
          </button>
        )}
      </header>

      <main style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "restaurant_dinner_board" ? (
          <RestaurantDinnerBoard
            user={user}
            kioskMode
            onOpenDreamBotChat={openDreamBotChat}
            initialSelectedGuestId={returnGuestId}
            onReturnGuestConsumed={() => setReturnGuestId(null)}
          />
        ) : (
          <div style={{ height: "calc(100vh - 56px)", minHeight: 400 }}>
            <WhatsAppInbox
              user={user}
              focusPhone={inboxFocus?.phone ?? null}
              focusGuestName={inboxFocus?.guestName ?? null}
              focusInboxChannel={inboxFocus?.inboxChannel ?? null}
              onFocusConsumed={() => setInboxFocus(null)}
              returnPage={inboxReturn?.page ?? null}
              returnPageLabel={inboxReturn?.label ?? null}
              onReturnToSource={inboxReturn?.page ? returnFromInbox : null}
            />
          </div>
        )}
      </main>
    </div>
  );
}
