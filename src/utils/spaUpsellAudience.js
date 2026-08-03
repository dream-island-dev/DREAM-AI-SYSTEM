import { GENERIC_DAY_PASS_ROOM, PREMIUM_DAY_ROOMS } from "../data/suiteRegistry";

/** Outbound channel pins for spa upsell manual dispatch (whatsapp-send force_channel). */
export const SPA_UPSELL_CHANNEL_WHAPI = "whapi_session";
export const SPA_UPSELL_CHANNEL_META = "meta_template";
/** Legacy Meta template name — kept for automation_stages / logs. */
export const SPA_UPSELL_META_TEMPLATE = "spa_upsell_daypass";
/** Approved Meta templates staff can pick for manual day-pass spa upsell. */
export const SPA_UPSELL_META_TEMPLATE_NAMES = [
  "spa_upsell_daypass1",
  "spa_upsell_daypass",
];
/** Default manual Meta template (new copy with «אשמח לתאם» button). */
export const SPA_UPSELL_META_TEMPLATE_DEFAULT = "spa_upsell_daypass1";

/** Live Meta body snapshot — {{1}} = guest name (fallback when API unavailable). */
export const SPA_UPSELL_META_BODY_TEMPLATE =
  "היי {{1}}💆\nלקראת הגעתכם לריזורט, נשמח להציע לכם טיפול ספא מרגיע של 45 דק׳ להזמנה שלכם במחיר מיוחד. עבורכם -300 ₪ לאדם בלבד (מחיר מלא 370 ₪).\nהשיבו לנו כאן וניצור עימכם קשר לצורך תיאום 🙏";

export const SPA_UPSELL_CHANNEL_OPTIONS = [
  {
    id: SPA_UPSELL_CHANNEL_META,
    label: "🔵 Dream Bot (Meta)",
    hint: "בחירת תבנית מאושרת — spa_upsell_daypass1 / spa_upsell_daypass",
  },
  {
    id: SPA_UPSELL_CHANNEL_WHAPI,
    label: "📱 מכשיר סוויטות (Whapi)",
    hint: "טקסט חופשי מ-bot_scripts.spa_upsell_daypass",
  },
];

/** Resolve live Meta body from get-wa-templates row; falls back to snapshot. */
export function resolveSpaUpsellMetaBodyText(metaTemplateRow, templateName = SPA_UPSELL_META_TEMPLATE_DEFAULT) {
  const live = String(metaTemplateRow?.bodyText ?? "").trim();
  if (live) return live;
  if (templateName === SPA_UPSELL_META_TEMPLATE) return SPA_UPSELL_META_BODY_TEMPLATE;
  return SPA_UPSELL_META_BODY_TEMPLATE;
}

/** Build catalog rows for SpaUpsellConfirmModal from get-wa-templates list. */
export function buildSpaUpsellMetaTemplateCatalog(templates = []) {
  return SPA_UPSELL_META_TEMPLATE_NAMES.map((name) => {
    const row = templates.find((t) => t.name === name);
    return {
      name,
      status: row?.status ?? null,
      bodyText: resolveSpaUpsellMetaBodyText(row, name),
    };
  });
}

export function isAllowedSpaUpsellMetaTemplate(name) {
  const key = String(name ?? "").trim();
  return SPA_UPSELL_META_TEMPLATE_NAMES.includes(key);
}

export function previewSpaUpsellMetaTemplate(guestName, metaBodyText) {
  const name = String(guestName ?? "").trim() || "אורח יקר";
  const template = String(metaBodyText ?? "").trim() || SPA_UPSELL_META_BODY_TEMPLATE;
  return template.replace(/\{\{\s*1\s*\}\}/g, name);
}

export function spaUpsellChannelLabel(forceChannel) {
  if (forceChannel === SPA_UPSELL_CHANNEL_META) return "🔵 Dream Bot";
  if (forceChannel === SPA_UPSELL_CHANNEL_WHAPI) return "📱 מכשיר סוויטות";
  return forceChannel || "—";
}

export function isDayPassGuestForUpsell(guest) {
  return (
    (guest?.room_type === "day_guest" || guest?.room_type === "premium_day_guest")
    && !!guest?.room
  );
}

/** Guest has a spa booking on the visit date (time or spa_date match). */
export function guestHasSpaOnDate(guest, dateYmd) {
  const arrival = dateYmd || guest?.arrival_date;
  return !!guest?.spa_time || (!!guest?.spa_date && guest.spa_date === arrival);
}

/** Single guest row — matches Doc1 post-sync rules in ArrivalImportPanel. */
export function isSpaUpsellEligible(guest, dateYmd) {
  if (!guest || guest.status === "cancelled") return false;
  if (!isDayPassGuestForUpsell(guest)) return false;
  if (guest.msg_spa_upsell_sent) return false;
  if (guestHasSpaOnDate(guest, dateYmd)) return false;
  return true;
}

/**
 * Load day-pass guests arriving on `arrivalDate` who have no spa and no prior upsell.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ arrivalDate: string }} opts — YYYY-MM-DD (Israel business day)
 */
export async function fetchSpaUpsellAudience(supabase, { arrivalDate }) {
  if (!supabase || !arrivalDate) return { guests: [], error: null };

  const { data, error } = await supabase
    .from("guests")
    .select("id, phone, name, room_type, room, spa_date, spa_time, arrival_date, status, msg_spa_upsell_sent")
    .eq("arrival_date", arrivalDate)
    .eq("msg_spa_upsell_sent", false)
    .neq("status", "cancelled")
    .not("phone", "is", null)
    .order("name");

  if (error) return { guests: [], error };

  const guests = (data ?? [])
    .filter((g) => isSpaUpsellEligible(g, arrivalDate))
    .map((g) => ({ id: g.id, name: g.name, phone: g.phone, room: g.room }));

  return { guests, error: null };
}

export function israelTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** Guests wrongly tagged Premium Day 1/2 (bulk fix after import bug). */
export async function fetchPremiumDayMisassignedGuests(supabase, { arrivalDate }) {
  if (!supabase || !arrivalDate) return { guests: [], error: null };

  const { data, error } = await supabase
    .from("guests")
    .select("id, name, phone, room, room_type, arrival_date, status")
    .eq("arrival_date", arrivalDate)
    .in("room", [...PREMIUM_DAY_ROOMS])
    .neq("status", "cancelled")
    .order("name");

  if (error) return { guests: [], error };

  return {
    guests: (data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      phone: g.phone,
      room: g.room,
      room_type: g.room_type,
    })),
    error: null,
  };
}

/** Promote mis-tagged Premium Day rows → plain בילוי יומי + day_guest. */
export async function bulkConvertPremiumDayToGenericDayPass(supabase, guestIds) {
  if (!supabase || !guestIds?.length) return { updated: 0, error: null };

  const { error } = await supabase
    .from("guests")
    .update({ room: GENERIC_DAY_PASS_ROOM, room_type: "day_guest" })
    .in("id", guestIds);

  if (error) return { updated: 0, error };

  return { updated: guestIds.length, error: null };
}
