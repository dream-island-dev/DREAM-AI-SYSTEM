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
import { _whapiBase, _tokenOrThrow } from "./whapiSend.ts";

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

const REQUESTS_GROUP_INTENT_PRIORITY = [
  "alert_inbox_routed",
  "alert_request",
  "portal_room_service",
  "portal_upsell",
  "portal_order",
] as const;

let _discoveredRequestsGroupId: string | null | undefined;
let _discoveredRequestsGroupAt = 0;
const DISCOVER_TTL_MS = 5 * 60 * 1000;

/** Best-effort: find "בקשות אורחים" (or Guest Requests) via Whapi when no JID is configured. */
async function discoverRequestsWhapiGroupId(): Promise<string | null> {
  if (_discoveredRequestsGroupId !== undefined && Date.now() - _discoveredRequestsGroupAt < DISCOVER_TTL_MS) {
    return _discoveredRequestsGroupId;
  }
  _discoveredRequestsGroupId = null;
  _discoveredRequestsGroupAt = Date.now();
  try {
    const token = _tokenOrThrow();
    const res = await fetch(`${_whapiBase()}/groups?count=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn("[routingConfig] Whapi groups list failed:", res.status);
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const groups = (data.groups ?? data.data ?? []) as Array<Record<string, unknown>>;
    const match = groups.find((g) => {
      const name = String(g.name ?? g.subject ?? "");
      return /בקשות\s*אורחים/i.test(name) || /guest\s*requests/i.test(name);
    });
    const id = (match?.id as string | undefined)?.trim() || null;
    if (id) console.log("[routingConfig] discovered requests Whapi group:", id);
    _discoveredRequestsGroupId = id;
    return id;
  } catch (e) {
    console.warn("[routingConfig] discover requests group failed:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve the Whapi JID for the Guest Requests channel ("בקשות אורחים").
 * Priority: WHAPI_REQUESTS_GROUP_ID secret → routing_config (intent rows) →
 * any requests-board row with a JID → Whapi name auto-discovery.
 */
export async function resolveRequestsWhapiGroupId(
  supabase: ReturnType<typeof createClient>,
  primaryIntent = "alert_inbox_routed",
): Promise<string | null> {
  const envId = (Deno.env.get("WHAPI_REQUESTS_GROUP_ID") ?? "").trim();
  if (envId) return envId;

  const map = await loadRoutingConfig(supabase);
  const intentOrder = [primaryIntent, ...REQUESTS_GROUP_INTENT_PRIORITY.filter((k) => k !== primaryIntent)];
  for (const key of intentOrder) {
    const gid = map.get(key)?.whatsapp_group_id?.trim();
    if (gid) return gid;
  }
  for (const [, row] of map) {
    if (row.destination_board === "requests" && row.whatsapp_group_id?.trim()) {
      return row.whatsapp_group_id.trim();
    }
  }

  return await discoverRequestsWhapiGroupId();
}
