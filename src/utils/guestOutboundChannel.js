// Default outbound channel + session window hints for single-guest compose (GuestDashboard, ReceptionistView).

import {
  isMetaSessionWindowOpenForContact,
  isWhapiSessionWindowOpenForContact,
} from "./inboxSendErrors";

/** Matches whatsapp-send isWindowOpen — guests.wa_window_expires_at from Meta inbound. */
export function isMetaWindowOpenFromGuest(guest) {
  const exp = guest?.wa_window_expires_at;
  if (!exp) return false;
  return new Date(exp).getTime() > Date.now();
}

export function contactShapeFromInboundRows(inboundRows) {
  return {
    inbox_channel: "unified",
    messages: (inboundRows ?? []).map((r) => ({
      direction: "inbound",
      inbox_channel: r.inbox_channel === "whapi" ? "whapi" : "meta",
      created_at: r.created_at,
    })),
  };
}

/**
 * @returns {{ defaultChannel: "meta"|"whapi", metaOpen: boolean, whapiOpen: boolean, whapiDisabled: boolean }}
 */
export function inferGuestOutboundDefaults(guest, inboundRows, whapiSosActive = false) {
  const contact = contactShapeFromInboundRows(inboundRows);
  const metaOpen = isMetaWindowOpenFromGuest(guest) || isMetaSessionWindowOpenForContact(contact);
  const whapiOpen = isWhapiSessionWindowOpenForContact(contact);

  if (whapiSosActive) {
    return { defaultChannel: "meta", metaOpen, whapiOpen, whapiDisabled: true };
  }

  let lastInbound = null;
  for (const r of inboundRows ?? []) {
    if (!lastInbound || r.created_at > lastInbound.created_at) lastInbound = r;
  }
  if (lastInbound) {
    const defaultChannel = lastInbound.inbox_channel === "whapi" ? "whapi" : "meta";
    return { defaultChannel, metaOpen, whapiOpen, whapiDisabled: false };
  }

  const isDaypass =
    guest?.room_type === "day_guest" || guest?.room_type === "premium_day_guest";
  if (isDaypass) {
    return { defaultChannel: "meta", metaOpen, whapiOpen, whapiDisabled: false };
  }

  return { defaultChannel: "whapi", metaOpen, whapiOpen, whapiDisabled: false };
}

/** Free-text via Meta needs an open Dream Bot window; Whapi only blocked on SOS. */
export function canSendGuestFreeText(sendChannel, { metaOpen, whapiSosActive }) {
  if (sendChannel === "whapi") return !whapiSosActive;
  return metaOpen;
}
