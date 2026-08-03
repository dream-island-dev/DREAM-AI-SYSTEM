// Spa group campaign inbound — wa.me link with campaign token → day-pass profile + spa lead.
// Meta (Dream Bot) only. Campaign registry in bot_config.spa_group_campaigns.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPhoneVariants } from "./arrivalConfirmation.ts";
import { dispatchGuestSpaIntent } from "./spaIntentRouting.ts";

export const SPA_GROUP_CAMPAIGNS_CONFIG_KEY = "spa_group_campaigns";
export const GENERIC_DAY_PASS_ROOM = "בילוי יומי";

const CONFIG_TTL_MS = 5 * 60 * 1000;

/** Token embedded in pre-filled WA text, e.g. XOS-EVE-1008 */
const CAMPAIGN_TOKEN_RE = /(XOS-[A-Z0-9-]+)/i;

/** Code fallback when bot_config row is missing (works before db push). */
export const BUILTIN_SPA_GROUP_CAMPAIGNS: SpaGroupCampaign[] = [
  {
    id: "everest-2026-08-10",
    token: "XOS-EVE-1008",
    label: "אוורסט טכנולוגיות",
    arrival_date: "2026-08-10",
    enabled: true,
  },
];

export type SpaGroupCampaign = {
  id: string;
  token: string;
  label: string;
  arrival_date: string;
  enabled?: boolean;
};

export type SpaGroupCampaignInboundAdapter = {
  patchInbound: (patch: Record<string, unknown>) => Promise<void>;
  sendReply: (replyText: string, intent: string, guestId: number) => Promise<void>;
  sourceLabel: string;
  logTag: string;
};

let _campaignsCache: SpaGroupCampaign[] | null = null;
let _campaignsCacheAt = 0;

export function parseSpaGroupCampaignToken(text: string): string | null {
  const match = String(text ?? "").match(CAMPAIGN_TOKEN_RE);
  return match?.[1]?.toUpperCase() ?? null;
}

export function resolveCampaignByToken(
  campaigns: SpaGroupCampaign[],
  token: string,
): SpaGroupCampaign | null {
  const norm = token.toUpperCase();
  return campaigns.find((c) => c.token.toUpperCase() === norm && c.enabled !== false) ?? null;
}

/** DB campaigns first; builtin fills gaps so deploy works before migration. */
export function resolveCampaignWithFallback(
  dbCampaigns: SpaGroupCampaign[],
  token: string,
): SpaGroupCampaign | null {
  return resolveCampaignByToken(dbCampaigns, token)
    ?? resolveCampaignByToken(BUILTIN_SPA_GROUP_CAMPAIGNS, token);
}

/** Guest-facing ack after group spa-offer link — not generic staff handoff. */
export function buildSpaGroupCampaignReply(guestName?: string | null): string {
  const name = String(guestName ?? "").trim();
  const hi = name ? `היי ${name}, ` : "";
  return (
    `${hi}תודה שפניתם אלינו! 💆\n` +
    "קיבלנו את בקשתכם לתיאום טיפול הספא במחיר ההטבה.\n" +
    "נציג מטעמנו יחזור אליכם בהקדם עם שעה פנויה 🙏"
  );
}

export function parseSpaGroupCampaignsConfig(raw: unknown): SpaGroupCampaign[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const campaigns = (parsed as { campaigns?: unknown }).campaigns;
  if (!Array.isArray(campaigns)) return [];
  const out: SpaGroupCampaign[] = [];
  for (const row of campaigns) {
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const token = String(r.token ?? "").trim().toUpperCase();
    const label = String(r.label ?? "").trim();
    const arrival_date = String(r.arrival_date ?? "").slice(0, 10);
    if (!id || !token || !arrival_date) continue;
    out.push({
      id,
      token,
      label: label || id,
      arrival_date,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

export async function loadSpaGroupCampaigns(
  supabase: SupabaseClient,
): Promise<SpaGroupCampaign[]> {
  const now = Date.now();
  if (_campaignsCache && now - _campaignsCacheAt < CONFIG_TTL_MS) {
    return _campaignsCache;
  }

  const { data, error } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", SPA_GROUP_CAMPAIGNS_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn("[spaGroupCampaign] bot_config load failed:", error.message);
    return _campaignsCache ?? [];
  }

  const campaigns = parseSpaGroupCampaignsConfig(data?.config_value);
  const merged = [...campaigns];
  for (const builtin of BUILTIN_SPA_GROUP_CAMPAIGNS) {
    if (!merged.some((c) => c.token === builtin.token)) merged.push(builtin);
  }
  _campaignsCache = merged;
  _campaignsCacheAt = now;
  return merged;
}

/** Test hook — reset module cache between tests. */
export function __resetSpaGroupCampaignCacheForTest(): void {
  _campaignsCache = null;
  _campaignsCacheAt = 0;
}

function mergeCampaignGuestProfile(
  existing: unknown,
  campaignId: string,
): Record<string, unknown> {
  const base = (existing && typeof existing === "object")
    ? { ...(existing as Record<string, unknown>) }
    : {};
  const spa = (base.spa && typeof base.spa === "object")
    ? { ...(base.spa as Record<string, unknown>) }
    : {};
  spa.group_campaign = campaignId;
  spa.source = "wa_group_link";
  base.spa = spa;
  return base;
}

const GUEST_SELECT_FIELDS =
  "id, name, phone, arrival_date, departure_date, room, room_type, status, guest_profile, msg_spa_upsell_sent";

export async function findOrCreateDaypassGuestForCampaign(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    pushName?: string | null;
    arrivalDate: string;
    campaignId: string;
  },
): Promise<Record<string, unknown> | null> {
  const { phone, pushName, arrivalDate, campaignId } = opts;
  const { variants } = buildPhoneVariants(phone);
  const e164 = variants.find((v) => v.startsWith("+")) ?? `+${phone.replace(/\D/g, "")}`;

  const { data: existing, error: lookupErr } = await supabase
    .from("guests")
    .select(GUEST_SELECT_FIELDS)
    .in("phone", variants)
    .eq("arrival_date", arrivalDate)
    .neq("status", "cancelled")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.warn("[spaGroupCampaign] guest lookup error:", lookupErr.message);
  }

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      guest_profile: mergeCampaignGuestProfile(existing.guest_profile, campaignId),
    };
    const existingName = String(existing.name ?? "").trim();
    const waName = String(pushName ?? "").trim();
    if (!existingName && waName) patch.name = waName;

    if (Object.keys(patch).length > 0) {
      const { data: updated, error: updErr } = await supabase
        .from("guests")
        .update(patch)
        .eq("id", existing.id)
        .select(GUEST_SELECT_FIELDS)
        .maybeSingle();
      if (updErr) {
        console.warn("[spaGroupCampaign] guest profile patch failed:", updErr.message);
        return existing as Record<string, unknown>;
      }
      return (updated ?? existing) as Record<string, unknown>;
    }
    return existing as Record<string, unknown>;
  }

  const waName = String(pushName ?? "").trim();
  const insert = {
    phone: e164,
    name: waName || null,
    arrival_date: arrivalDate,
    departure_date: arrivalDate,
    room_type: "day_guest",
    room: GENERIC_DAY_PASS_ROOM,
    status: "pending",
    guest_profile: mergeCampaignGuestProfile(null, campaignId),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("guests")
    .insert(insert)
    .select(GUEST_SELECT_FIELDS)
    .maybeSingle();

  if (insertErr) {
    console.error("[spaGroupCampaign] guest insert failed:", insertErr.message);
    return null;
  }

  if (inserted?.phone) {
    await supabase.from("bookings").upsert({
      phone: String(inserted.phone).replace(/^\+/, ""),
      guest_name: inserted.name ?? null,
      arrival_date: arrivalDate,
      status: "expected",
      room_count: 1,
    }, { onConflict: "phone,arrival_date" });
  }

  return inserted as Record<string, unknown> | null;
}

/**
 * Tier-0: campaign token in inbound text → day-pass profile + spa_upsell_accept lead.
 * Returns true when the message was handled (including deduped re-clicks).
 */
export async function runSpaGroupCampaignInbound(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    text: string;
    pushName?: string | null;
    conversationId: number | null;
    sim?: boolean;
  },
  adapter: SpaGroupCampaignInboundAdapter,
): Promise<boolean> {
  const token = parseSpaGroupCampaignToken(opts.text);
  if (!token) return false;

  const campaigns = await loadSpaGroupCampaigns(supabase);
  const campaign = resolveCampaignWithFallback(campaigns, token);
  if (!campaign) {
    console.info(`[${adapter.logTag}] spa group campaign token not found/disabled: ${token}`);
    return false;
  }

  const guest = await findOrCreateDaypassGuestForCampaign(supabase, {
    phone: opts.phone,
    pushName: opts.pushName,
    arrivalDate: campaign.arrival_date,
    campaignId: campaign.id,
  });

  const guestName = (guest?.name as string | null) ?? opts.pushName ?? null;
  const reply = buildSpaGroupCampaignReply(guestName);

  if (!guest?.id) {
    console.error(`[${adapter.logTag}] spa group campaign guest create failed token:${token}`);
    if (!opts.sim) {
      try {
        await adapter.sendReply(reply, "spa_group_campaign", 0);
      } catch (e) {
        console.error(`[${adapter.logTag}] spa group campaign fallback reply failed:`, (e as Error).message);
      }
    }
    return true;
  }

  const guestId = guest.id as number;
  const guestRoom = (guest.room as string | null) ?? null;
  const message = opts.text.trim() || `אישור הצעת ספא — ${campaign.label}`;

  await adapter.patchInbound({
    guest_id: guestId,
    intent: "spa_group_campaign",
  });

  const dispatch = await dispatchGuestSpaIntent(supabase, {
    guestId,
    phone: opts.phone,
    guest,
    message,
    alertType: "spa_upsell_accept",
    conversationId: opts.conversationId,
    guestName,
    room: guestRoom,
    sourceLabel: adapter.sourceLabel,
    guestReplyForOwnerDm: opts.text,
    dedupeOpenLead: true,
  });

  if (!dispatch.ok) {
    console.error(`[${adapter.logTag}] spa group campaign dispatch failed:`, dispatch.error);
    if (!opts.sim) {
      try {
        await adapter.sendReply(reply, "spa_group_campaign", guestId);
      } catch (e) {
        console.error(`[${adapter.logTag}] spa group campaign reply after dispatch fail:`, (e as Error).message);
      }
    }
    return true;
  }

  if (!opts.sim) {
    try {
      await adapter.sendReply(reply, "spa_upsell_accept", guestId);
    } catch (e) {
      console.error(`[${adapter.logTag}] spa group campaign reply failed:`, (e as Error).message);
    }
  } else {
    console.info(
      `[${adapter.logTag}] SIM — spa group campaign ${campaign.id} guest:${guestId} dedupe:${dispatch.alreadyExists ?? false}`,
    );
  }

  console.info(
    `[${adapter.logTag}] spa group campaign — token:${token} guest:${guestId} arrival:${campaign.arrival_date} dedupe:${dispatch.alreadyExists ?? false}`,
  );
  return true;
}
