// Whapi device health probe — GET /health (wakeup=false avoids launching a
// stopped channel). Used by whatsapp-cron + automation-health-cron to persist
// status into bot_config so guestWhapiRouting can auto-failover to Meta.

import { _tokenOrThrow, _whapiBase } from "./whapiSend.ts";

/** Whapi channel statuses that mean outbound guest messaging is safe. */
export const WHAPI_HEALTHY_STATUS_TEXTS = new Set(["AUTH"]);

export type WhapiHealthSnapshot = {
  healthy: boolean;
  statusText: string;
  checkedAt: string;
  httpStatus: number | null;
  error: string | null;
  uptimeSeconds: number | null;
};

export function isWhapiStatusTextHealthy(statusText: string | null | undefined): boolean {
  const t = String(statusText ?? "").trim().toUpperCase();
  if (!t) return false;
  return WHAPI_HEALTHY_STATUS_TEXTS.has(t);
}

/**
 * Probes Whapi gate /health. Does not throw on network errors — returns
 * healthy=false with error populated (FAIL VISIBLE for persistence layer).
 */
export async function probeWhapiDeviceHealth(opts: { wakeup?: boolean } = {}): Promise<WhapiHealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const wakeup = opts.wakeup === true;
  let token: string;
  try {
    token = _tokenOrThrow("WHAPI_TOKEN");
  } catch (e) {
    return {
      healthy: false,
      statusText: "NO_TOKEN",
      checkedAt,
      httpStatus: null,
      error: (e as Error).message,
      uptimeSeconds: null,
    };
  }

  const url = `${_whapiBase()}/health?wakeup=${wakeup ? "true" : "false"}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const httpStatus = res.status;
    let body: Record<string, unknown> = {};
    try {
      body = await res.json() as Record<string, unknown>;
    } catch {
      body = {};
    }

    const statusObj = body.status as { text?: string; code?: number } | undefined;
    const statusText = String(statusObj?.text ?? (httpStatus >= 500 ? "HTTP_500" : "UNKNOWN")).trim().toUpperCase();
    const healthy = res.ok && isWhapiStatusTextHealthy(statusText);
    const uptimeRaw = body.uptime;
    const uptimeSeconds = typeof uptimeRaw === "number" && Number.isFinite(uptimeRaw) ? uptimeRaw : null;

    if (!res.ok) {
      return {
        healthy: false,
        statusText,
        checkedAt,
        httpStatus,
        error: `http_${httpStatus}`,
        uptimeSeconds,
      };
    }

    return {
      healthy,
      statusText,
      checkedAt,
      httpStatus,
      error: healthy ? null : `status_${statusText}`,
      uptimeSeconds,
    };
  } catch (e) {
    return {
      healthy: false,
      statusText: "PROBE_FAILED",
      checkedAt,
      httpStatus: null,
      error: (e as Error).message,
      uptimeSeconds: null,
    };
  }
}

/** bot_config keys written by health probes (service-role callers only). */
export const WHAPI_HEALTH_CONFIG_KEYS = {
  status: "whapi_device_status",
  healthy: "whapi_device_healthy",
  checkedAt: "whapi_device_checked_at",
  sosManual: "whapi_guest_sos_active",
  autoFailover: "whapi_auto_failover",
} as const;

// deno-lint-ignore no-explicit-any
export async function persistWhapiHealthToBotConfig(
  supabase: any,
  snapshot: WhapiHealthSnapshot,
): Promise<void> {
  const rows = [
    { config_key: WHAPI_HEALTH_CONFIG_KEYS.status, config_value: snapshot.statusText },
    { config_key: WHAPI_HEALTH_CONFIG_KEYS.healthy, config_value: snapshot.healthy ? "true" : "false" },
    { config_key: WHAPI_HEALTH_CONFIG_KEYS.checkedAt, config_value: snapshot.checkedAt },
  ];
  for (const row of rows) {
    const { error } = await supabase
      .from("bot_config")
      .update({ config_value: row.config_value })
      .eq("config_key", row.config_key);
    if (error) {
      console.warn(`[whapiHealth] bot_config update failed for ${row.config_key}:`, error.message);
    }
  }
}
