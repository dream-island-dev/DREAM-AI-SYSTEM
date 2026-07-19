// Restaurant dinner board — WA send + channel routing.

import {
  composeAskMessage,
  composeConfirmMessage,
  composeCustomMessage,
} from "./restaurantDinnerMessagesConfig";

export {
  BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY,
  DINNER_MESSAGE_PLACEHOLDER_HELP,
  DEFAULT_RESTAURANT_DINNER_MESSAGES,
  normalizeRestaurantDinnerMessages,
  serializeRestaurantDinnerMessages,
  formatSlotsHebrew,
  buildDinnerMessageVars,
  renderDinnerMessageTemplate,
  composeAskMessage,
  composeConfirmMessage,
  composeCustomMessage,
  cloneDefaultRestaurantDinnerMessages,
} from "./restaurantDinnerMessagesConfig";

/** @deprecated use composeAskMessage with config */
export function buildDinnerAskMessage(guestName, slots, mealLocation, config = null) {
  return composeAskMessage(config, { guestName, slots, location: mealLocation });
}

/** @deprecated use composeConfirmMessage with config */
export function buildDinnerConfirmMessage(guestName, dinnerTime, mealLocation, config = null) {
  return composeConfirmMessage(config, { guestName, time: dinnerTime, location: mealLocation });
}

/** Suite dinner guests → Whapi device; day-pass / unknown → Meta. */
export function resolveRestaurantGuestWaChannel(guest) {
  const rt = String(guest?.room_type ?? "").trim();
  if (rt === "day_guest" || rt === "premium_day_guest") return "meta";
  const room = String(guest?.room ?? "").trim();
  if (/^Premium Day/i.test(room)) return "meta";
  if (room) return "whapi";
  return "meta";
}

export function formatWaSendError(data, fallback) {
  if (data?.status === "window_closed") {
    return "חלון 24 שעות סגור — פתחו את הלשונית «שיחות» לתשובה בתבנית, או המתינו לתשובת האורח.";
  }
  if (data?.error?.includes("forbidden") || data?.error?.includes("unauthorized")) {
    return "אין הרשאת שליחה — פנו למנהל המערכת (תפקיד מסעדה).";
  }
  if (data?.status === "whapi_disabled") {
    return data?.error ?? "מכשיר הסוויטות כבוי כרגע.";
  }
  if (data?.status === "timeout") {
    return "לא ודאי אם ההודעה הגיעה — בדקו בוואטסאפ.";
  }
  return data?.error ?? data?.message ?? fallback ?? "שגיאה בשליחה";
}

export async function sendRestaurantGuestWa(supabase, guest, message) {
  const phone = String(guest?.phone ?? "").trim();
  if (!phone) throw new Error("לאורח אין מספר טלפון");
  const text = String(message ?? "").trim();
  if (!text) throw new Error("הודעה ריקה");

  const { data, error } = await supabase.functions.invoke("whatsapp-send", {
    body: {
      trigger: "inbox_reply",
      phone,
      message: text,
      inbox_channel: resolveRestaurantGuestWaChannel(guest),
    },
  });

  if (error || !data?.ok) {
    throw new Error(formatWaSendError(data, error?.message));
  }
  return data;
}
