// Spa upsell offer pricing — parsed from bot_scripts.spa_upsell_daypass (single source of truth).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SPA_UPSELL_SCRIPT_KEY = "spa_upsell_daypass";

/** Defaults when script text has no parseable prices (current live offer). */
export const SPA_UPSELL_DEFAULT_OFFER_PRICE = 280;
export const SPA_UPSELL_DEFAULT_FULL_PRICE = 380;
export const SPA_UPSELL_DEFAULT_DURATION_MIN = 45;

export type SpaUpsellPricing = {
  offerPrice: number;
  fullPrice: number;
  durationMin: number;
};

export function formatSpaUpsellOfferLabel(pricing: SpaUpsellPricing): string {
  return `${pricing.offerPrice}₪/${pricing.durationMin} דק׳`;
}

export function buildSpaUpsellAcceptSummary(offerLabel: string): string {
  return `🧖 אישר/ה הצעת טיפול ספא (${offerLabel}) — לתאם שעה ולשבץ בלוח הספא`;
}

export function buildSpaUpsellAcceptForwardLine(offerLabel: string): string {
  return `מעוניין/ת בטיפול ספא (${offerLabel}) — לתאם שעה`;
}

/** Pure parse — used by tests and DB fetch. */
export function parseSpaUpsellPricingFromScript(text: string): SpaUpsellPricing {
  const raw = String(text ?? "");
  const durationMatch = raw.match(/(\d+)\s*דק/);
  const durationMin = durationMatch
    ? Number(durationMatch[1])
    : SPA_UPSELL_DEFAULT_DURATION_MIN;

  const paired = raw.match(
    /(\d+)\s*₪[\s\S]{0,80}?מחיר\s*מלא\s*(\d+)\s*₪/iu,
  );
  if (paired) {
    return {
      offerPrice: Number(paired[1]),
      fullPrice: Number(paired[2]),
      durationMin,
    };
  }

  const prices = [...raw.matchAll(/(\d+)\s*₪/g)].map((m) => Number(m[1]));
  if (prices.length >= 2) {
    const sorted = [...prices].sort((a, b) => a - b);
    return {
      offerPrice: sorted[0],
      fullPrice: sorted[sorted.length - 1],
      durationMin,
    };
  }
  if (prices.length === 1) {
    return {
      offerPrice: prices[0],
      fullPrice: SPA_UPSELL_DEFAULT_FULL_PRICE,
      durationMin,
    };
  }

  return {
    offerPrice: SPA_UPSELL_DEFAULT_OFFER_PRICE,
    fullPrice: SPA_UPSELL_DEFAULT_FULL_PRICE,
    durationMin,
  };
}

let cachedScriptText: string | null = null;
let cachedPricing: SpaUpsellPricing | null = null;

export function resetSpaUpsellPricingCacheForTests(): void {
  cachedScriptText = null;
  cachedPricing = null;
}

export async function resolveSpaUpsellPricing(
  supabase: SupabaseClient,
): Promise<SpaUpsellPricing> {
  const { data, error } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", SPA_UPSELL_SCRIPT_KEY)
    .maybeSingle();

  const scriptText = !error ? String(data?.message_text ?? "").trim() : "";
  if (cachedPricing && scriptText === cachedScriptText) {
    return cachedPricing;
  }

  const pricing = parseSpaUpsellPricingFromScript(scriptText);
  cachedScriptText = scriptText;
  cachedPricing = pricing;
  return pricing;
}

export async function resolveSpaUpsellOfferLabel(
  supabase: SupabaseClient,
): Promise<string> {
  const pricing = await resolveSpaUpsellPricing(supabase);
  return formatSpaUpsellOfferLabel(pricing);
}
