// Armonim restaurant kiosk — shift gate + branded shell + board + inbox.

import { useState, useCallback } from "react";
import "../../styles/armonimKiosk.css";
import RestaurantDinnerBoard from "../RestaurantDinnerBoard";
import WhatsAppInbox from "../WhatsAppInbox";
import { RESTAURANT_FOCUS_NAV_IDS } from "../../utils/auth";
import { RestaurantShiftProvider, useRestaurantShift } from "../../context/RestaurantShiftContext";
import RestaurantShiftGate from "./RestaurantShiftGate";
import RestaurantKioskHeader from "./RestaurantKioskHeader";

const TABS = [
  { id: "restaurant_dinner_board", label: "🕐 לוח ערמונים" },
  { id: "wa_inbox", label: "💬 שיחות" },
];

function RestaurantKioskInner({ user, onLogout }) {
  const { session, booting, endShift, kioskUi } = useRestaurantShift();
  const [activeTab, setActiveTab] = useState("restaurant_dinner_board");
  const [inboxFocus, setInboxFocus] = useState(null);
  const [inboxReturn, setInboxReturn] = useState(null);
  const [returnGuestId, setReturnGuestId] = useState(null);
  const [endingShift, setEndingShift] = useState(false);

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

  const handleEndShift = async () => {
    setEndingShift(true);
    try {
      await endShift();
    } catch {
      // fail silent — user can retry
    } finally {
      setEndingShift(false);
    }
  };

  if (booting) {
    return (
      <div className="armonim-kiosk" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: "var(--armonim-brown)" }}>טוען…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="armonim-kiosk">
        <RestaurantShiftGate />
      </div>
    );
  }

  return (
    <div className="armonim-kiosk">
      <RestaurantKioskHeader
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onEndShift={handleEndShift}
        endingShift={endingShift}
      />

      {kioskUi.evening_hours_line && activeTab === "restaurant_dinner_board" && (
        <div style={{
          padding: "8px 14px", fontSize: 12, fontWeight: 600,
          color: "var(--armonim-brown)", background: "rgba(0,128,128,0.06)",
          borderBottom: "1px solid var(--armonim-border)",
          textAlign: "right",
        }}>
          {kioskUi.evening_hours_line}
          {kioskUi.external_menu_url && (
            <>
              {" · "}
              <a
                href={kioskUi.external_menu_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--armonim-teal)" }}
              >
                תפריט באתר
              </a>
            </>
          )}
        </div>
      )}

      <main style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "restaurant_dinner_board" ? (
          <RestaurantDinnerBoard
            user={user}
            kioskMode
            brandedShell
            onOpenDreamBotChat={openDreamBotChat}
            initialSelectedGuestId={returnGuestId}
            onReturnGuestConsumed={() => setReturnGuestId(null)}
          />
        ) : (
          <div style={{ height: "calc(100vh - 120px)", minHeight: 400 }}>
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

      {onLogout && (
        <div style={{ padding: "8px 14px", textAlign: "left", borderTop: "1px solid var(--armonim-border)" }}>
          <button type="button" className="armonim-kiosk-btn-ghost" style={{ color: "var(--armonim-brown)" }} onClick={onLogout}>
            יציאה מהמערכת (מנהל)
          </button>
        </div>
      )}
    </div>
  );
}

export default function RestaurantKioskShell({ user, onLogout }) {
  return (
    <RestaurantShiftProvider user={user}>
      <RestaurantKioskInner user={user} onLogout={onLogout} />
    </RestaurantShiftProvider>
  );
}
