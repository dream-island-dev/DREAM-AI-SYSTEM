// supabase/functions/_shared/frontDeskMorningBrief.ts
// Morning arrival brief for Adir (front desk) — shared by cron + get_arrival_desk_brief tool.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { israelYmd } from "./automationSchedule.ts";
import { addDaysYmd } from "./resortPulseStats.ts";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  ADIR_MORNING_BRIEF_DEFAULTS,
  applyStaffMessageTemplate,
  mergeDigestConfig,
  resolveStaffTemplate,
  STAFF_TEMPLATE_KEYS,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

export type ArrivalDeskGuestRow = {
  name: string | null;
  room: string | null;
  room_type: string | null;
  status: string;
  arrival_date: string | null;
  arrival_time: string | null;
  requires_attention: boolean | null;
};

export type OpenAlertRow = {
  id: number;
  alert_type: string;
  message: string;
  guests: { name: string | null; room: string | null } | null;
};

const ALERT_TYPE_LABEL_HE: Record<string, string> = {
  request: "🛎️ בקשה",
  complaint: "😤 תלונה",
  severe_complaint: "🚨 תלונה חמורה",
  date_change_request: "🗓️ שינוי תאריך",
  upsell_opportunity: "🌴 פורטל",
  portal_room_service: "🍽️ שירות לחדר",
  spa_request: "💆 ספא",
  financial_issue: "💳 חיוב",
  arrival_eta: "🕐 שעת הגעה",
};

const GUEST_STATUS_LABEL_HE: Record<string, string> = {
  pending:     "ממתין",
  expected:    "צפוי",
  room_ready:  "חדר מוכן",
  checked_in:  "בנוי",
  checked_out: "יצא",
  cancelled:   "בוטל",
};

function formatGuestLine(g: ArrivalDeskGuestRow, dayLabel: string): string {
  const attn = g.requires_attention ? " ⚠VIP" : "";
  const time = g.arrival_time?.trim() ? ` ${g.arrival_time}` : "";
  const status = GUEST_STATUS_LABEL_HE[g.status] ?? g.status;
  return `• ${g.name ?? "—"} — ${g.room ?? "—"} (${dayLabel})${time}${attn} [${status}]`;
}

export type ArrivalDeskBrief = {
  todayYmd: string;
  tomorrowYmd: string;
  todayTotal: number;
  todayWithTime: number;
  todayMissingTime: number;
  tomorrowTotal: number;
  summary: string;
};

/** Desk arrival list — today + tomorrow suite guests (tool + cron body). */
export function composeArrivalDeskBrief(
  rows: ArrivalDeskGuestRow[],
  now: Date = new Date(),
): ArrivalDeskBrief {
  const todayYmd = israelYmd(now);
  const tomorrowYmd = addDaysYmd(todayYmd, 1);
  const suites = rows.filter((g) => isEffectiveSuiteGuest(g));

  const todayGuests = suites.filter((g) => g.arrival_date === todayYmd);
  const tomorrowGuests = suites.filter((g) => g.arrival_date === tomorrowYmd);

  const todayWithTime: string[] = [];
  const todayMissing: string[] = [];
  for (const g of todayGuests) {
    const line = formatGuestLine(g, "היום");
    if (g.arrival_time?.trim()) todayWithTime.push(line);
    else todayMissing.push(line);
  }

  const tomorrowLines = tomorrowGuests.map((g) => formatGuestLine(g, "מחר"));

  const parts = [
    `📋 לוח הגעות סוויטות (${todayYmd} / ${tomorrowYmd})`,
    `היום — עם שעה (${todayWithTime.length}):`,
    todayWithTime.length ? todayWithTime.join("\n") : "— אין —",
    `היום — בלי שעה (${todayMissing.length}):`,
    todayMissing.length ? todayMissing.join("\n") : "— הכל מדווח —",
  ];
  if (tomorrowGuests.length) {
    parts.push(`מחר (${tomorrowGuests.length}):`, tomorrowLines.join("\n"));
  }

  return {
    todayYmd,
    tomorrowYmd,
    todayTotal: todayGuests.length,
    todayWithTime: todayWithTime.length,
    todayMissingTime: todayMissing.length,
    tomorrowTotal: tomorrowGuests.length,
    summary: parts.join("\n"),
  };
}

export type FrontDeskMorningStats = {
  brief: ArrivalDeskBrief;
  openActionable: OpenAlertRow[];
  openEtaCount: number;
};

export async function fetchFrontDeskMorningStats(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<FrontDeskMorningStats> {
  const todayYmd = israelYmd(now);
  const tomorrowYmd = addDaysYmd(todayYmd, 1);

  const [guestsRes, alertsRes] = await Promise.all([
    supabase
      .from("guests")
      .select("name, room, room_type, status, arrival_date, arrival_time, requires_attention")
      .in("arrival_date", [todayYmd, tomorrowYmd])
      .not("status", "eq", "cancelled")
      .order("arrival_date", { ascending: true })
      .order("arrival_time", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("guest_alerts")
      .select("id, alert_type, message, guests(name, room)")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (guestsRes.error) throw new Error(guestsRes.error.message);

  const brief = composeArrivalDeskBrief((guestsRes.data ?? []) as ArrivalDeskGuestRow[], now);

  const allAlerts = (alertsRes.error ? [] : (alertsRes.data ?? [])) as unknown as OpenAlertRow[];
  const openActionable = allAlerts.filter((a) => a.alert_type !== "arrival_eta").slice(0, 5);
  const openEtaCount = allAlerts.filter((a) => a.alert_type === "arrival_eta").length;

  return { brief, openActionable, openEtaCount };
}

function formatDateHe(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** Full Whapi morning DM — arrivals + open requests. Power hints only before onboarding sent. */
export function buildFrontDeskMorningMessage(
  stats: FrontDeskMorningStats,
  opts: { includePowerHints?: boolean; templates?: StaffTemplateMap } = {},
): string {
  const includePowerHints = opts.includePowerHints !== false;
  const { brief, openActionable, openEtaCount } = stats;
  const dateHe = formatDateHe(brief.todayYmd);

  const shellRow = resolveStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ADIR_MORNING_BRIEF);
  const shell = mergeDigestConfig(ADIR_MORNING_BRIEF_DEFAULTS, shellRow?.digest_config);

  const openSummary = openActionable.length
    ? `${openActionable.length} בקשות לטיפול`
    : "אין בקשות דחופות";

  const headline = [
    applyStaffMessageTemplate(shell.greeting, {}),
    applyStaffMessageTemplate(shell.title, { date_he: dateHe }),
    "",
    applyStaffMessageTemplate(shell.snapshot, {
      today_total: brief.todayTotal,
      missing_time: brief.todayMissingTime,
      open_summary: openSummary,
    }),
  ];
  if (openEtaCount) {
    headline.push(applyStaffMessageTemplate(shell.eta_note, { eta_count: openEtaCount }));
  }
  if (brief.tomorrowTotal) {
    headline.push(applyStaffMessageTemplate(shell.tomorrow_note, { tomorrow_total: brief.tomorrowTotal }));
  }

  const sections: string[] = [...headline, "", brief.summary];

  if (brief.todayMissingTime > 0) {
    sections.push(
      "",
      applyStaffMessageTemplate(shell.missing_time_cta, { missing_time: brief.todayMissingTime }),
    );
  }

  if (openActionable.length) {
    sections.push("", shell.open_header);
    for (const a of openActionable) {
      const label = ALERT_TYPE_LABEL_HE[a.alert_type] ?? `⚠ ${a.alert_type}`;
      const who = a.guests?.room
        ? `${a.guests.name ?? "אורח"} (${a.guests.room})`
        : (a.guests?.name ?? "אורח");
      sections.push(`• ${label} — ${who}: ${(a.message ?? "").slice(0, 100)}`);
    }
  }

  sections.push(
    "",
    `📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`,
    `💬 אינבוקס: ${buildStaffAppDeepLink({ page: "wa_inbox" })}`,
  );

  if (includePowerHints) {
    sections.splice(
      sections.length - 2,
      0,
      "",
      shell.power_hints,
    );
  }

  return sections.join("\n");
}

export function frontDeskMorningEnabled(): boolean {
  const raw = (Deno.env.get("FRONT_DESK_MORNING_ENABLED") ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}
