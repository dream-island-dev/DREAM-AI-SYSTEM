// supabase/functions/automation-health-cron/index.ts
//
// Automation watchdog (Phase 2 of the health-monitor approved by Mike,
// session 2026-07-08). Runs on its own pg_cron schedule (migration 163) and:
//   1. Writes its OWN heartbeat (dogfooding cron_heartbeats, migration 162).
//   2. Runs a fixed set of read-only checks against notification_log,
//      ai_failover_events, cron_heartbeats and live Meta template status.
//   3. Tracks each check's ok/alerting state in automation_health_alerts and
//      pings the ops Whapi group ONLY on a state transition (ok→alerting or
//      alerting→ok), or a periodic re-ping while an issue stays open
//      (ALERT_REPEAT_HOURS) — never on every single run, to avoid flooding
//      the group with the same open issue every 10 minutes.
//
// This function NEVER writes to guests/notification_log/whatsapp_conversations
// and never sends anything to a guest — zero blast radius on the guest
// pipeline. Its only guest-facing-adjacent action is reading.
//
// ?preview=true (or GET) returns the live check results WITHOUT writing state
// or sending any Whapi alert — this is what the ACC "🩺 בריאות אוטומציה" tab
// (Phase 3) calls so staff can see current status any time without waiting
// for the next scheduled tick or flipping the enable switch below.
//
// Same dedicated kill-switch convention as sla-escalation-cron: the WRITE +
// ALERT path (the scheduled pg_cron call) does nothing until
// AUTOMATION_HEALTH_ENABLED=true is set explicitly in Supabase Secrets.
// Deploying without it is inert — the migration/cron exist but this is
// intentionally a brand-new, unverified process; preview reads still work
// regardless so Mike can sanity-check it in ACC before switching it live.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { probeWhapiDeviceHealth, persistWhapiHealthToBotConfig } from "../_shared/whapiHealth.ts";
import { deliverExecutiveDmReply } from "../_shared/executiveAssistant.ts";
import { ARCHITECT_PHONE_DIGITS } from "../_shared/executiveIdentity.ts";
import {
  ARCHITECT_RELEVANT_CHECK_KEYS,
  composeArchitectHealthHint,
  HUMAN_REQUESTED_ALERT_THRESHOLD,
  isHumanRequestedSpike,
  isPendingApprovalSpike,
  PENDING_APPROVAL_ALERT_THRESHOLD,
} from "../_shared/architectHealthHint.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HEARTBEAT_STALE_MINUTES = 20; // wa-cron runs every 15 min (migration 007) — 20 gives one-tick buffer
const LOOKBACK_HOURS = 2;
const FAILED_RATE_MIN_TOTAL = 5;   // don't judge a rate off tiny sample sizes
const FAILED_RATE_THRESHOLD = 0.3; // >30% failed/timeout in the window is worth a page
const FAILOVER_COUNT_THRESHOLD = 5;
const ALERT_REPEAT_HOURS = 2; // re-ping cadence for an issue that stays open

type CheckResult = {
  checkKey: string;
  bad: boolean;
  detail: Record<string, unknown>;
  badMessage: string; // Hebrew — sent to Whapi ops group on ok→alerting (or repeat-ping)
  okMessage: string;  // Hebrew — sent to Whapi ops group on alerting→ok
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function resolveAlertGroupId(): Promise<string> {
  return (
    Deno.env.get("AUTOMATION_HEALTH_GROUP_ID") ??
    Deno.env.get("SLA_ALERT_GROUP_ID") ??
    Deno.env.get("WHAPI_GROUP_ID") ??
    ""
  ).trim();
}

async function checkWhapiDeviceHealth(
  supabase: ReturnType<typeof createClient>,
  opts: { persist?: boolean } = {},
): Promise<CheckResult & { snapshot?: Awaited<ReturnType<typeof probeWhapiDeviceHealth>> }> {
  const snapshot = await probeWhapiDeviceHealth({ wakeup: false });
  if (opts.persist) {
    try {
      await persistWhapiHealthToBotConfig(supabase, snapshot);
    } catch (e) {
      console.warn("[automation-health-cron] whapi health persist failed:", (e as Error).message);
    }
  }
  const bad = !snapshot.healthy;
  return {
    checkKey: "whapi_device_health",
    bad,
    snapshot,
    detail: {
      status: snapshot.statusText,
      healthy: snapshot.healthy,
      checked_at: snapshot.checkedAt,
      error: snapshot.error,
      uptime_seconds: snapshot.uptimeSeconds,
    },
    badMessage:
      `🚨 בריאות אוטומציה: מכשיר Whapi לא זמין (סטטוס: ${snapshot.statusText}` +
      `${snapshot.error ? `, ${snapshot.error}` : ""}) — אורחים יעברו אוטומטית ל-Dream Bot אם Failover מופעל.`,
    okMessage: `✅ בריאות אוטומציה: מכשיר Whapi פעיל (${snapshot.statusText}) — ניתן להחזיר ערוץ Whapi ב-ACC.`,
  };
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkHeartbeat(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("cron_heartbeats")
    .select("last_run_at")
    .eq("job_name", "whatsapp-cron")
    .maybeSingle();

  if (error) {
    // FAIL VISIBLE (CLAUDE.md §0.3): a read failure here must not collapse into
    // "healthy" — this watchdog's entire job is proving automation is alive,
    // so losing the ability to even check that is itself an alert-worthy state.
    console.warn("[automation-health-cron] cron_heartbeats read failed:", error.message);
    return {
      checkKey: "cron_heartbeat_wa_cron",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את heartbeat של whatsapp-cron (${error.message}) — לא ניתן לוודא שהאוטומציה פעילה.`,
      okMessage: "✅ בריאות אוטומציה: קריאת heartbeat של whatsapp-cron חזרה לתקין.",
    };
  }
  if (!data) {
    // No heartbeat row yet (fresh deploy, first 15-min tick hasn't happened) — not an alert.
    return { checkKey: "cron_heartbeat_wa_cron", bad: false, detail: { note: "no heartbeat row yet" }, badMessage: "", okMessage: "" };
  }

  const row = data as { last_run_at: string };
  const ageMinutes = (Date.now() - new Date(row.last_run_at).getTime()) / 60000;
  const bad = ageMinutes > HEARTBEAT_STALE_MINUTES;

  return {
    checkKey: "cron_heartbeat_wa_cron",
    bad,
    detail: { last_run_at: row.last_run_at, age_minutes: Math.round(ageMinutes) },
    badMessage:
      `🚨 בריאות אוטומציה: whatsapp-cron לא דיווח "דופק" כבר ${Math.round(ageMinutes)} דקות ` +
      `(סף: ${HEARTBEAT_STALE_MINUTES}). ייתכן שהאוטומציה תקועה — בדוק ב-Supabase → Edge Functions → Logs.`,
    okMessage: "✅ בריאות אוטומציה: whatsapp-cron חזר לדווח דופק כרגיל.",
  };
}

async function checkDuplicateLookupFailed(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("notification_log")
    .select("guest_id, trigger_type, payload")
    .eq("status", "duplicate_blocked")
    .gte("sent_at", since)
    .limit(200);

  if (error) {
    console.warn("[automation-health-cron] notification_log (duplicate) read failed:", error.message);
    return {
      checkKey: "duplicate_lookup_failed",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את notification_log לבדיקת כפילויות (${error.message}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת notification_log (בדיקת כפילויות) חזרה לתקין.",
    };
  }

  const rows = (data ?? []) as Array<{ guest_id: number | null; trigger_type: string; payload: Record<string, unknown> | null }>;
  const lookupFailed = rows.filter((r) => r.payload?.reason === "lookup_failed");
  const bad = lookupFailed.length > 0;

  return {
    checkKey: "duplicate_lookup_failed",
    bad,
    detail: {
      count: lookupFailed.length,
      window_hours: LOOKBACK_HOURS,
      sample: lookupFailed.slice(0, 3).map((r) => ({ guest_id: r.guest_id, trigger_type: r.trigger_type })),
    },
    badMessage:
      `🚨 בריאות אוטומציה: ${lookupFailed.length} שליחות נחסמו ב-${LOOKBACK_HOURS} השעות האחרונות כי לא ניתן ` +
      `היה לוודא מניעת-כפילות (notification_log לא נקרא) — זה חוסם שליחות אמיתיות, לא כפילויות אמיתיות. ` +
      `בדוק חיבור/הרשאות ל-notification_log.`,
    okMessage: `✅ בריאות אוטומציה: חסימת "lookup_failed" (מניעת-כפילות) חזרה לאפס.`,
  };
}

async function checkFailedRate(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();

  const [failedRes, okRes] = await Promise.all([
    supabase.from("notification_log").select("id", { count: "exact", head: true })
      .in("status", ["failed", "timeout"]).gte("sent_at", since),
    supabase.from("notification_log").select("id", { count: "exact", head: true })
      .in("status", ["sent", "simulated"]).gte("sent_at", since),
  ]);

  if (failedRes.error || okRes.error) {
    const msg = failedRes.error?.message ?? okRes.error?.message ?? "unknown";
    console.warn("[automation-health-cron] notification_log (rate) read failed:", msg);
    return {
      checkKey: "notification_failed_rate",
      bad: true,
      detail: { error: msg },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את notification_log לבדיקת קצב כשלים (${msg}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת notification_log (קצב כשלים) חזרה לתקין.",
    };
  }

  const failed = failedRes.count ?? 0;
  const ok = okRes.count ?? 0;
  const total = failed + ok;
  const rate = total > 0 ? failed / total : 0;
  const bad = total >= FAILED_RATE_MIN_TOTAL && rate > FAILED_RATE_THRESHOLD;

  return {
    checkKey: "notification_failed_rate",
    bad,
    detail: { failed, ok, total, rate: Math.round(rate * 100) / 100, window_hours: LOOKBACK_HOURS },
    badMessage:
      `🚨 בריאות אוטומציה: ${failed} מתוך ${total} הודעות אוטומציה נכשלו/timeout ב-${LOOKBACK_HOURS} השעות ` +
      `האחרונות (${Math.round(rate * 100)}%). בדוק חיבור Meta/Whapi ותוקף טוקנים.`,
    okMessage: "✅ בריאות אוטומציה: קצב הכשלים בהודעות אוטומציה חזר לתקין.",
  };
}

async function checkFailoverRate(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from("ai_failover_events")
    .select("id", { count: "exact", head: true })
    .gte("occurred_at", since);

  if (error) {
    console.warn("[automation-health-cron] ai_failover_events read failed:", error.message);
    return {
      checkKey: "ai_failover_rate",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את ai_failover_events (${error.message}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת ai_failover_events חזרה לתקין.",
    };
  }

  const n = count ?? 0;
  const bad = n >= FAILOVER_COUNT_THRESHOLD;

  return {
    checkKey: "ai_failover_rate",
    bad,
    detail: { count: n, window_hours: LOOKBACK_HOURS, threshold: FAILOVER_COUNT_THRESHOLD },
    badMessage:
      `⚠️ בריאות אוטומציה: ${n} מעברי failover בין Gemini↔Claude ב-${LOOKBACK_HOURS} השעות האחרונות — ` +
      `ייתכן שמנוע ה-AI המועדף לא זמין (מפתח/מכסה).`,
    okMessage: "✅ בריאות אוטומציה: קצב ה-failover בין מנועי ה-AI חזר לתקין.",
  };
}

// Architect-relevant checks (Mike's personal event-gated pulse — see architectHealthHint.ts).
// Reuse the exact same queries already proven in executiveAssistant.ts's get_system_health tool.

async function checkPendingApprovalSpike(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const { data, error } = await supabase.from("tasks").select("id").eq("status", "pending_approval").limit(100);

  if (error) {
    console.warn("[automation-health-cron] tasks (pending_approval) read failed:", error.message);
    return {
      checkKey: "pending_approval_spike",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את tasks לבדיקת משימות pending_approval (${error.message}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת tasks (pending_approval) חזרה לתקין.",
    };
  }

  const count = (data ?? []).length;
  const bad = isPendingApprovalSpike(count);

  return {
    checkKey: "pending_approval_spike",
    bad,
    detail: { count, threshold: PENDING_APPROVAL_ALERT_THRESHOLD },
    badMessage:
      `🚨 בריאות אוטומציה: ${count} משימות ממתינות לאישור (סף: ${PENDING_APPROVAL_ALERT_THRESHOLD}) — ` +
      `ייתכן שהצוות לא מספיק לאשר בזמן.`,
    okMessage: "✅ בריאות אוטומציה: כמות המשימות הממתינות לאישור חזרה לתקין.",
  };
}

async function checkHumanRequestedSpike(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("phone")
    .eq("direction", "inbound")
    .eq("human_requested", true)
    .limit(200);

  if (error) {
    console.warn("[automation-health-cron] whatsapp_conversations (human_requested) read failed:", error.message);
    return {
      checkKey: "human_requested_spike",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את whatsapp_conversations לבדיקת human_requested (${error.message}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת whatsapp_conversations (human_requested) חזרה לתקין.",
    };
  }

  const count = new Set(
    ((data ?? []) as Array<{ phone: string }>).map((r) => r.phone).filter(Boolean),
  ).size;
  const bad = isHumanRequestedSpike(count);

  return {
    checkKey: "human_requested_spike",
    bad,
    detail: { count, threshold: HUMAN_REQUESTED_ALERT_THRESHOLD },
    badMessage:
      `🚨 בריאות אוטומציה: ${count} שיחות עם human_requested פתוח (סף: ${HUMAN_REQUESTED_ALERT_THRESHOLD}) — ` +
      `ייתכן שבקשות אורחים נתקעות ב-Inbox בלי מענה.`,
    okMessage: "✅ בריאות אוטומציה: כמות שיחות ה-human_requested חזרה לתקין.",
  };
}

// Template names come from automation_stages (live DB config) — NOT a
// hardcoded copy of whatsapp-send's PIPELINE_TEMPLATE map, so this can never
// drift from what's actually configured (DNA §0.5 single source of truth).
async function checkTemplateApprovals(
  supabase: ReturnType<typeof createClient>,
): Promise<CheckResult[]> {
  const { data: stages, error } = await supabase
    .from("automation_stages")
    .select("meta_template_name")
    .eq("is_active", true)
    .not("meta_template_name", "is", null);

  if (error) {
    console.warn("[automation-health-cron] automation_stages read failed:", error.message);
    return [{
      checkKey: "automation_stages_read_error",
      bad: true,
      detail: { error: error.message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן לקרוא את automation_stages כדי לבדוק תבניות (${error.message}).`,
      okMessage: "✅ בריאות אוטומציה: קריאת automation_stages חזרה לתקין.",
    }];
  }

  const names = [...new Set(
    (stages ?? [])
      .map((r) => (r as { meta_template_name: string | null }).meta_template_name?.trim())
      .filter((n): n is string => !!n),
  )];
  if (names.length === 0) return [];

  let templates: Array<{ name: string; status: string }>;
  try {
    const { data, error: invokeErr } = await supabase.functions.invoke("get-wa-templates", { body: { all: true } });
    if (invokeErr) throw new Error(invokeErr.message);
    const body = data as { ok: boolean; templates?: Array<{ name: string; status: string }>; error?: string };
    if (!body?.ok) throw new Error(body?.error ?? "unknown_error");
    templates = body.templates ?? [];
  } catch (e) {
    // One combined check when Meta itself is unreachable — avoids N noisy
    // per-template alerts for a single connectivity/token problem.
    return [{
      checkKey: "template_approval_lookup",
      bad: true,
      detail: { error: (e as Error).message },
      badMessage: `⚠️ בריאות אוטומציה: לא ניתן היה לבדוק סטטוס אישור תבניות מול Meta (${(e as Error).message}).`,
      okMessage: "✅ בריאות אוטומציה: בדיקת סטטוס תבניות מול Meta חזרה לתקין.",
    }];
  }

  const byName = new Map(templates.map((t) => [t.name, t.status]));
  return names.map((name) => {
    const status = byName.get(name) ?? "NOT_FOUND";
    const bad = status !== "APPROVED";
    return {
      checkKey: `template_approval:${name}`,
      bad,
      detail: { template: name, status },
      badMessage:
        `🚨 בריאות אוטומציה: תבנית "${name}" (בשימוש פעיל באוטומציה) במצב "${status}" ב-Meta, לא APPROVED — ` +
        `הודעות שמשתמשות בה עלולות להיכשל.`,
      okMessage: `✅ בריאות אוטומציה: תבנית "${name}" אושרה ב-Meta.`,
    };
  });
}

// ── Reconcile one check's result against stored state, alert on transition ──

async function reconcileCheck(
  supabase: ReturnType<typeof createClient>,
  c: CheckResult,
  alertGroupId: string,
): Promise<{ checkKey: string; status: "ok" | "alerting"; prevStatus: "ok" | "alerting"; alerted: boolean; detail: Record<string, unknown> }> {
  const { data: existing } = await supabase
    .from("automation_health_alerts")
    .select("status, first_detected_at, last_alerted_at")
    .eq("check_key", c.checkKey)
    .maybeSingle();

  const prev = existing as { status?: string; first_detected_at?: string | null; last_alerted_at?: string | null } | null;
  const prevStatus = prev?.status ?? "ok";
  const newStatus: "ok" | "alerting" = c.bad ? "alerting" : "ok";
  const now = new Date();
  const nowIso = now.toISOString();

  let shouldSend = false;
  if (newStatus === "alerting") {
    if (prevStatus !== "alerting") {
      shouldSend = true;
    } else if (prev?.last_alerted_at) {
      const hoursSince = (now.getTime() - new Date(prev.last_alerted_at).getTime()) / 3600000;
      shouldSend = hoursSince >= ALERT_REPEAT_HOURS;
    } else {
      shouldSend = true;
    }
  } else if (prevStatus === "alerting") {
    shouldSend = true; // resolved — one closing message
  }

  const newRow = {
    check_key: c.checkKey,
    status: newStatus,
    first_detected_at: newStatus === "alerting" ? (prev?.first_detected_at ?? nowIso) : null,
    last_alerted_at: shouldSend ? nowIso : (prev?.last_alerted_at ?? null),
    last_checked_at: nowIso,
    detail: c.detail,
  };

  // Optimistic claim against the ok<->alerting race: two overlapping invocations
  // (e.g. a retried pg_net tick) could otherwise both read the same prevStatus
  // and both send the same Whapi alert. Only the run whose UPDATE actually moves
  // the row FROM the exact prevStatus it read gets to send the message; a run
  // that loses the race (0 rows affected — someone else already flipped it)
  // skips sending and skips overwriting state with a now-stale decision.
  let wonClaim: boolean;
  if (existing) {
    const { data: updated, error: updErr } = await supabase
      .from("automation_health_alerts")
      .update(newRow)
      .eq("check_key", c.checkKey)
      .eq("status", prevStatus)
      .select("check_key")
      .maybeSingle();
    if (updErr) {
      console.warn(`[automation-health-cron] reconcile update failed for ${c.checkKey}:`, updErr.message);
      wonClaim = false;
    } else {
      wonClaim = !!updated;
    }
  } else {
    // First-ever row for this check_key — a concurrent first insert from
    // another run would violate the primary key; that run "wins" instead.
    const { error: insErr } = await supabase.from("automation_health_alerts").insert(newRow);
    wonClaim = !insErr;
  }

  const message = newStatus === "alerting" ? c.badMessage : c.okMessage;
  const alerted = wonClaim && shouldSend && !!message;
  if (alerted) {
    if (alertGroupId) {
      try {
        await sendWhapiText(alertGroupId, message);
      } catch (e) {
        console.error(`[automation-health-cron] Whapi alert send failed for ${c.checkKey}:`, (e as Error).message);
      }
    } else {
      console.warn(
        `[automation-health-cron] would alert on ${c.checkKey} but no AUTOMATION_HEALTH_GROUP_ID/SLA_ALERT_GROUP_ID/WHAPI_GROUP_ID configured.`,
      );
    }
  }

  return { checkKey: c.checkKey, status: newStatus, prevStatus: prevStatus as "ok" | "alerting", alerted, detail: c.detail };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const reqUrl = new URL(req.url);
    let isPreview = req.method === "GET" || reqUrl.searchParams.get("preview") === "true";
    let probeWhapiOnly = false;
    if (req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        if (body?.preview === true) isPreview = true;
        if (body?.probeWhapi === true) probeWhapiOnly = true;
      } catch { /* no/empty body */ }
    }

    if (probeWhapiOnly) {
      const whapiCheck = await checkWhapiDeviceHealth(supabase, { persist: true });
      return jsonResponse({
        ok: true,
        probeWhapi: true,
        whapi: whapiCheck.snapshot,
        check: { checkKey: whapiCheck.checkKey, bad: whapiCheck.bad, detail: whapiCheck.detail },
      });
    }

    // Dogfood our own heartbeat — proves this watchdog itself is alive. Only on
    // a real (non-preview) tick, so opening the ACC health tab is truly read-only.
    if (!isPreview) {
      await supabase.from("cron_heartbeats").upsert(
        { job_name: "automation-health-cron", last_run_at: new Date().toISOString() },
        { onConflict: "job_name" },
      );
    }

    const checks: CheckResult[] = [
      await checkHeartbeat(supabase),
      await checkDuplicateLookupFailed(supabase),
      await checkFailedRate(supabase),
      await checkFailoverRate(supabase),
      await checkWhapiDeviceHealth(supabase, { persist: !isPreview }),
      await checkPendingApprovalSpike(supabase),
      await checkHumanRequestedSpike(supabase),
      ...(await checkTemplateApprovals(supabase)),
    ];

    if (isPreview) {
      // Read-only — no state write, no Whapi send. Used by the ACC health tab
      // so staff can see live status any time regardless of AUTOMATION_HEALTH_ENABLED.
      return jsonResponse({ ok: true, preview: true, checks });
    }

    if (Deno.env.get("AUTOMATION_HEALTH_ENABLED") !== "true") {
      console.log("[automation-health-cron] 🚫 HALTED — AUTOMATION_HEALTH_ENABLED not set to 'true'. No alerts sent, no state written.");
      return jsonResponse({ ok: true, halted: true, reason: "AUTOMATION_HEALTH_ENABLED_not_set", checks });
    }

    const alertGroupId = await resolveAlertGroupId();
    const results = [];
    for (const c of checks) {
      const result = await reconcileCheck(supabase, c, alertGroupId);
      results.push(result);

      // Mike's personal architect pulse — only on a genuine ok<->alerting flip
      // (result.alerted also fires on automation-health-cron's periodic repeat-ping
      // for a still-open issue; prevStatus !== status excludes that on purpose).
      if (
        result.alerted &&
        result.prevStatus !== result.status &&
        ARCHITECT_RELEVANT_CHECK_KEYS.has(result.checkKey)
      ) {
        try {
          const hint = composeArchitectHealthHint(result.checkKey, result.status === "ok", result.detail);
          await deliverExecutiveDmReply(supabase, { phone: ARCHITECT_PHONE_DIGITS, replyText: hint });
        } catch (e) {
          console.error(`[automation-health-cron] architect DM failed for ${result.checkKey}:`, (e as Error).message);
        }
      }
    }

    return jsonResponse({ ok: true, checks: results });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[automation-health-cron] fatal error:", msg);
    return jsonResponse({ ok: false, error: msg }, 200);
  }
});
