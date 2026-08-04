import { GENERIC_DAY_PASS_ROOM, PREMIUM_DAY_ROOMS } from "../data/suiteRegistry";
import { isEffectiveDayPassGuest } from "./pipelineSegment";

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

/**
 * Spa lead audience — tagged on guest_profile.spa.lead_audience before a manual
 * send so a later "אשמח לתאם" reply already knows whether the resulting
 * guest_alerts lead is a regular guest or a group booking. Mirrors the marker
 * spaGroupCampaign.ts already sets (group_campaign/source='wa_group_link') for
 * the automated wa.me link path — both paths converge on the same field so
 * downstream lead-routing (SpaLeadsPage, Meirav email) has one source of truth.
 */
export const SPA_LEAD_AUDIENCE_REGULAR = "regular";
export const SPA_LEAD_AUDIENCE_GROUP = "group";

export const SPA_LEAD_AUDIENCE_OPTIONS = [
  { id: SPA_LEAD_AUDIENCE_REGULAR, label: "👤 אורח רגיל" },
  { id: SPA_LEAD_AUDIENCE_GROUP, label: "👥 קבוצה" },
];

/** Read the tagged audience off a guest row — untagged/legacy guests default to "regular". */
export function resolveSpaLeadAudience(guest) {
  const spa = guest?.guest_profile?.spa;
  if (!spa) return SPA_LEAD_AUDIENCE_REGULAR;
  if (spa.lead_audience === SPA_LEAD_AUDIENCE_GROUP) return SPA_LEAD_AUDIENCE_GROUP;
  if (spa.group_campaign || spa.source === "wa_group_link") return SPA_LEAD_AUDIENCE_GROUP;
  return SPA_LEAD_AUDIENCE_REGULAR;
}

/**
 * Tag guest_profile.spa.lead_audience="group" (+ optional free-text group_label)
 * on a batch of guests right before a manual "קבוצה" send. No-op for "regular"
 * (untagged already reads back as regular — nothing to write). Best-effort:
 * a failed tag never blocks the WhatsApp send itself, so callers should not
 * await this before dispatching — it only affects later lead routing.
 */
export async function tagSpaUpsellLeadAudience(supabase, guestIds, { audience, groupLabel } = {}) {
  if (!supabase || !guestIds?.length || audience !== SPA_LEAD_AUDIENCE_GROUP) return { error: null };

  const { data: rows, error: fetchErr } = await supabase
    .from("guests")
    .select("id, guest_profile")
    .in("id", guestIds);
  if (fetchErr) return { error: fetchErr };

  const label = String(groupLabel ?? "").trim();
  for (const row of rows ?? []) {
    const profile = (row.guest_profile && typeof row.guest_profile === "object") ? { ...row.guest_profile } : {};
    const spa = (profile.spa && typeof profile.spa === "object") ? { ...profile.spa } : {};
    spa.lead_audience = SPA_LEAD_AUDIENCE_GROUP;
    if (label) spa.group_label = label;
    profile.spa = spa;
    const { error } = await supabase.from("guests").update({ guest_profile: profile }).eq("id", row.id);
    if (error) return { error };
  }
  return { error: null };
}

/** Guest has a spa booking on the visit date (time or spa_date match). */
export function guestHasSpaOnDate(guest, dateYmd) {
  const arrival = dateYmd || guest?.arrival_date;
  return !!guest?.spa_time || (!!guest?.spa_date && guest.spa_date === arrival);
}

/**
 * Single guest row — matches Doc1 post-sync rules in ArrivalImportPanel.
 * Uses isEffectiveDayPassGuest (not raw room_type) so a guest whose room is a
 * canonical physical suite is never treated as day-pass audience even when
 * room_type was mistagged 'day_guest'/'premium_day_guest' — the suite/day-pass
 * split-brain (see _shared/suiteNames.ts hasSuiteRoomTypeConflict).
 */
export function isSpaUpsellEligible(guest, dateYmd) {
  if (!guest || guest.status === "cancelled") return false;
  if (!isEffectiveDayPassGuest(guest)) return false;
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
