// supabase/functions/_shared/routingConfig.ts
// Dynamic intent → board/group/SLA routing (routing_config table, migration 121).
//
// Two operational channels, Mike directive:
//   "operations" — physical field tasks (towels/water/maintenance), SLA-tracked,
//                  Whapi group "קריאות".
//   "requests"   — future orders / spa / room-service / portal reservations,
//                  NO rigid SLA clock, Whapi group "בקשות אורחים".
//
// Every caller supplies a `fallback` — the exact behavior the code had before
// this table existed. A missing/unconfigured row (or a query error, e.g. the
// migration hasn't been applied yet in some environment) resolves to that
// fallback, never to a hard failure — this table is additive, not a new
// single point of failure for message delivery.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RoutingConfigRow = {
  destination_board: "operations" | "requests";
  whatsapp_group_id: string | null;
  enable_sla: boolean;
};

let _cache: Map<string, RoutingConfigRow> | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // same 5-min convention as whatsapp-webhook's _configCache/_botSettingsCache

async function loadRoutingConfig(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, RoutingConfigRow>> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const { data, error } = await supabase
    .from("routing_config")
    .select("intent_type, destination_board, whatsapp_group_id, enable_sla");
  if (error) {
    console.warn("[routingConfig] load failed — falling back to per-call defaults:", error.message);
    _cache = new Map();
  } else {
    _cache = new Map(
      (data ?? []).map((r: any) => [
        r.intent_type as string,
        {
          destination_board: r.destination_board,
          whatsapp_group_id: r.whatsapp_group_id ?? null,
          enable_sla: r.enable_sla,
        } as RoutingConfigRow,
      ]),
    );
  }
  _cacheAt = Date.now();
  return _cache;
}

/** Resolve routing for one intent_type, degrading to `fallback` when unconfigured. */
export async function resolveRouting(
  supabase: ReturnType<typeof createClient>,
  intentType: string,
  fallback: RoutingConfigRow,
): Promise<RoutingConfigRow> {
  const map = await loadRoutingConfig(supabase);
  const row = map.get(intentType);
  if (!row) return fallback;
  return {
    destination_board: row.destination_board ?? fallback.destination_board,
    whatsapp_group_id: row.whatsapp_group_id ?? fallback.whatsapp_group_id,
    enable_sla: row.enable_sla,
  };
}

/** `tasks.source` → routing_config intent_type. 1:1 today, kept as a function so a future divergence (e.g. splitting guest_request by department) has one place to change. */
export function taskIntentType(source: string | null | undefined): string {
  return source ?? "manual";
}

/** `guest_alerts.alert_type` → routing_config intent_type (namespaced so it can't collide with a tasks.source key). */
export function alertIntentType(alertType: string | null | undefined): string {
  return `alert_${alertType ?? "request"}`;
}
