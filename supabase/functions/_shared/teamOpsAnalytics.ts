// supabase/functions/_shared/teamOpsAnalytics.ts
// Pure aggregation for Staff Group Analytics (Eliad executive assistant).
// Zero I/O — caller fetches rows; same pattern as resortDigestStats.ts.

import {
  displayNameForStaffPhone,
  personMatchesFilter,
  resolvePersonKey,
  type StaffGroupKey,
} from "./staffGroupIngest.ts";
import { resolveDigestRange, type DigestPeriod } from "./resortDigestStats.ts";

export type { DigestPeriod as TeamOpsPeriod };

export type StaffGroupMessageRow = {
  from_phone: string | null;
  from_name: string | null;
  profile_id: string | null;
  group_key: string;
  message_kind: string;
  is_operational: boolean;
  operational_kind: string | null;
  created_at: string;
};

export type TeamOpsTaskRow = {
  id: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  reporter_profile_id: string | null;
  resolved_by_phone: string | null;
  resolved_by_name: string | null;
  sla_deadline: string | null;
};

export type HousekeepingEventRow = {
  room_id: string;
  event_type: string;
  created_at: string;
  from_phone: string | null;
  from_name: string | null;
};

export type GuestAlertRow = {
  id: number;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

export type PersonPresenceStat = {
  personKey: string;
  displayName: string;
  messageCount: number;
  presencePct: number | null;
};

export type PersonOperationalStat = {
  personKey: string;
  displayName: string;
  tasksOpened: number;
  tasksResolved: number;
  hkSignals: number;
  totalActions: number;
  operationalSharePct: number | null;
  avgResolveMinutes: number | null;
  resolveCount: number;
};

export type TurnaroundEntry = {
  roomId: string;
  checkoutAt: string;
  readyAt: string;
  minutes: number;
};

export type TeamOpsStats = {
  period: DigestPeriod;
  periodLabel: string;
  groupFilter: StaffGroupKey | "all";
  personFilter: string | null;
  totalHumanMessages: number;
  loggedMessageCount: number;
  presence: PersonPresenceStat[];
  operational: PersonOperationalStat[];
  housekeepingTurnaround: {
    pairs: number;
    avgMinutes: number | null;
    medianMinutes: number | null;
    slowest: TurnaroundEntry[];
  };
  guestAlerts: {
    opened: number;
    resolved: number;
    avgResolveMinutes: number | null;
  };
  teamAvgResolveMinutes: number | null;
  coverageNote: string;
};

function displayNameFromKey(personKey: string, phone?: string | null, fromName?: string | null): string {
  if (personKey.startsWith("phone:")) {
    const d = personKey.slice(6);
    return displayNameForStaffPhone(d) ?? fromName?.trim() ?? d;
  }
  if (personKey.startsWith("name:")) return personKey.slice(5);
  return personKey;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

function humanMessages(rows: StaffGroupMessageRow[]): StaffGroupMessageRow[] {
  return rows.filter((r) => r.message_kind !== "reaction" || r.is_operational);
}

export function computePresenceStats(
  messages: StaffGroupMessageRow[],
  personFilter?: string | null,
): PersonPresenceStat[] {
  const human = humanMessages(messages);
  const total = human.length;
  const byPerson = new Map<string, { count: number; phone: string | null; name: string | null }>();

  for (const m of human) {
    if (personFilter && !personMatchesFilter(personFilter, m.from_phone, m.from_name)) continue;
    const key = resolvePersonKey(m.from_phone, m.from_name);
    const cur = byPerson.get(key) ?? { count: 0, phone: m.from_phone, name: m.from_name };
    cur.count += 1;
    byPerson.set(key, cur);
  }

  const stats: PersonPresenceStat[] = [];
  for (const [personKey, { count, phone, name }] of byPerson) {
    stats.push({
      personKey,
      displayName: displayNameFromKey(personKey, phone, name),
      messageCount: count,
      presencePct: total > 0 ? Math.round((count / total) * 100) : null,
    });
  }
  return stats.sort((a, b) => b.messageCount - a.messageCount);
}

export function computeOperationalStats(
  tasks: TeamOpsTaskRow[],
  hkEvents: HousekeepingEventRow[],
  reporterNames: Map<string, string>,
  personFilter?: string | null,
): PersonOperationalStat[] {
  const byPerson = new Map<string, PersonOperationalStat>();
  const resolveMinutes = new Map<string, number[]>();

  const ensure = (key: string, displayName: string): PersonOperationalStat => {
    let s = byPerson.get(key);
    if (!s) {
      s = {
        personKey: key,
        displayName,
        tasksOpened: 0,
        tasksResolved: 0,
        hkSignals: 0,
        totalActions: 0,
        operationalSharePct: null,
        avgResolveMinutes: null,
        resolveCount: 0,
      };
      byPerson.set(key, s);
    }
    return s;
  };

  for (const t of tasks) {
    if (t.reporter_profile_id) {
      const name = reporterNames.get(t.reporter_profile_id) ?? "דווח (פרופיל)";
      const key = `profile:${t.reporter_profile_id}`;
      if (!personFilter || personMatchesFilter(personFilter, null, name, name)) {
        const s = ensure(key, name);
        s.tasksOpened += 1;
        s.totalActions += 1;
      }
    }
    if (t.status === "done" && t.resolved_at) {
      const key = resolvePersonKey(t.resolved_by_phone, t.resolved_by_name);
      const display = displayNameFromKey(key, t.resolved_by_phone, t.resolved_by_name);
      if (!personFilter || personMatchesFilter(personFilter, t.resolved_by_phone, t.resolved_by_name, display)) {
        const s = ensure(key, display);
        s.tasksResolved += 1;
        s.totalActions += 1;
        s.resolveCount += 1;
        const mins = minutesBetween(t.created_at, t.resolved_at);
        const arr = resolveMinutes.get(key) ?? [];
        arr.push(mins);
        resolveMinutes.set(key, arr);
      }
    }
  }

  for (const e of hkEvents) {
    const key = resolvePersonKey(e.from_phone, e.from_name);
    const display = displayNameFromKey(key, e.from_phone, e.from_name);
    if (!personFilter || personMatchesFilter(personFilter, e.from_phone, e.from_name, display)) {
      const s = ensure(key, display);
      s.hkSignals += 1;
      s.totalActions += 1;
    }
  }

  const totalActions = [...byPerson.values()].reduce((sum, p) => sum + p.totalActions, 0);
  for (const s of byPerson.values()) {
    s.operationalSharePct = totalActions > 0 ? Math.round((s.totalActions / totalActions) * 100) : null;
    const mins = resolveMinutes.get(s.personKey);
    s.avgResolveMinutes = mins?.length ? avg(mins) : null;
  }

  return [...byPerson.values()].sort((a, b) => b.totalActions - a.totalActions);
}

/** checkout event → next ready event for same room_id within the period window. */
export function computeHousekeepingTurnaround(events: HousekeepingEventRow[]): {
  pairs: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  slowest: TurnaroundEntry[];
} {
  const byRoom = new Map<string, HousekeepingEventRow[]>();
  for (const e of events) {
    const list = byRoom.get(e.room_id) ?? [];
    list.push(e);
    byRoom.set(e.room_id, list);
  }

  const durations: TurnaroundEntry[] = [];
  for (const [roomId, list] of byRoom) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let lastCheckout: string | null = null;
    for (const e of sorted) {
      if (e.event_type === "check_out") {
        lastCheckout = e.created_at;
      } else if (e.event_type === "ready" && lastCheckout) {
        const minutes = minutesBetween(lastCheckout, e.created_at);
        if (minutes >= 0 && minutes < 24 * 60) {
          durations.push({ roomId, checkoutAt: lastCheckout, readyAt: e.created_at, minutes });
        }
        lastCheckout = null;
      }
    }
  }

  const mins = durations.map((d) => d.minutes);
  const slowest = [...durations].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  return {
    pairs: durations.length,
    avgMinutes: avg(mins),
    medianMinutes: median(mins),
    slowest,
  };
}

export function computeGuestAlertStats(alerts: GuestAlertRow[]): {
  opened: number;
  resolved: number;
  avgResolveMinutes: number | null;
} {
  const opened = alerts.length;
  const resolvedRows = alerts.filter((a) => a.resolved && a.resolved_at);
  const mins = resolvedRows.map((a) => minutesBetween(a.created_at, a.resolved_at!));
  return {
    opened,
    resolved: resolvedRows.length,
    avgResolveMinutes: avg(mins),
  };
}

export function computeTeamOpsStats(inputs: {
  period: DigestPeriod;
  now?: Date;
  groupFilter?: StaffGroupKey | "all";
  personFilter?: string | null;
  messages: StaffGroupMessageRow[];
  tasks: TeamOpsTaskRow[];
  hkEvents: HousekeepingEventRow[];
  guestAlerts: GuestAlertRow[];
  reporterNames?: Map<string, string>;
}): TeamOpsStats {
  const now = inputs.now ?? new Date();
  const range = resolveDigestRange(inputs.period, now);
  const groupFilter = inputs.groupFilter ?? "all";
  const personFilter = inputs.personFilter?.trim() || null;
  const reporterNames = inputs.reporterNames ?? new Map<string, string>();

  let messages = inputs.messages;
  if (groupFilter !== "all") {
    messages = messages.filter((m) => m.group_key === groupFilter);
  }

  const human = humanMessages(messages);
  const presence = computePresenceStats(messages, personFilter);
  const operational = computeOperationalStats(
    inputs.tasks,
    inputs.hkEvents,
    reporterNames,
    personFilter,
  );
  const housekeepingTurnaround = computeHousekeepingTurnaround(inputs.hkEvents);
  const guestAlerts = computeGuestAlertStats(inputs.guestAlerts);

  const allResolveMins: number[] = [];
  for (const t of inputs.tasks) {
    if (t.status === "done" && t.resolved_at) {
      allResolveMins.push(minutesBetween(t.created_at, t.resolved_at));
    }
  }

  const loggedCount = messages.length;
  const coverageNote = loggedCount === 0
    ? "⚠️ אין עדיין הודעות קבוצה בלוג — מדדי נוכחות יתחילו מהיום. מדדי פעולה (משימות/חדרנות) מבוססים על נתונים היסטוריים."
    : loggedCount < 10
    ? "ℹ️ לוג הודעות קבוצה חדש — מדדי נוכחות עדיין חלקיים."
    : "";

  return {
    period: inputs.period,
    periodLabel: range.label,
    groupFilter,
    personFilter,
    totalHumanMessages: human.length,
    loggedMessageCount: loggedCount,
    presence,
    operational,
    housekeepingTurnaround,
    guestAlerts,
    teamAvgResolveMinutes: avg(allResolveMins),
    coverageNote,
  };
}

const GROUP_LABEL_HE: Record<string, string> = {
  all: "כל הקבוצות",
  ops_calls: "קריאות תפעול",
  housekeeping: "חדרנות (צ׳ק-אין/אאוט)",
  guest_requests: "בקשות אורחים",
  managers: "מנהלות",
  other: "אחר",
};

function formatMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}ש׳ ${r}ד׳` : `${h}ש׳`;
}

/**
 * Hebrew summary for the executive assistant — actionable, not raw JSON.
 */
export function composeTeamOpsMessage(stats: TeamOpsStats): string {
  const lines: string[] = [];
  const groupLabel = GROUP_LABEL_HE[stats.groupFilter] ?? stats.groupFilter;
  const personLine = stats.personFilter ? ` · ${stats.personFilter}` : "";

  lines.push(`📊 אנליטיקת צוות — ${stats.periodLabel}${personLine}`);
  lines.push(`קבוצה: ${groupLabel}`);

  if (stats.coverageNote) lines.push(stats.coverageNote);

  if (stats.personFilter && stats.presence.length === 0 && stats.operational.length === 0) {
    lines.push(`לא נמצאו נתונים עבור «${stats.personFilter}» בתקופה זו.`);
    return lines.join("\n");
  }

  if (stats.presence.length) {
    lines.push("");
    lines.push("💬 נוכחות (הודעות בקבוצה):");
    for (const p of stats.presence.slice(0, 8)) {
      const pct = p.presencePct !== null ? `${p.presencePct}%` : "—";
      lines.push(`• ${p.displayName}: ${p.messageCount} הודעות (${pct})`);
    }
  } else if (stats.loggedMessageCount === 0) {
    lines.push("");
    lines.push("💬 נוכחות: אין לוג הודעות עדיין — ראה מדדי פעולה למטה.");
  }

  if (stats.operational.length) {
    lines.push("");
    lines.push("⚙️ מעורבות תפעולית (פתיחות + סגירות + אותות חדרנות):");
    for (const o of stats.operational.slice(0, 8)) {
      const share = o.operationalSharePct !== null ? `${o.operationalSharePct}%` : "—";
      const resolve = o.avgResolveMinutes !== null
        ? ` · סגירה ממוצעת ${formatMinutes(o.avgResolveMinutes)}`
        : "";
      lines.push(
        `• ${o.displayName}: ${o.totalActions} פעולות (${share})` +
        ` — פתח ${o.tasksOpened}, סגר ${o.tasksResolved}, חדרנות ${o.hkSignals}${resolve}`,
      );
    }
  }

  if (stats.groupFilter === "all" || stats.groupFilter === "housekeeping") {
    const hk = stats.housekeepingTurnaround;
    if (hk.pairs > 0) {
      lines.push("");
      lines.push(
        `🛏️ זמן checkout→מוכן: ממוצע ${formatMinutes(hk.avgMinutes)}` +
        ` · חציון ${formatMinutes(hk.medianMinutes)} (${hk.pairs} חדרים)`,
      );
      if (hk.slowest.length) {
        const slow = hk.slowest.slice(0, 3).map((s) => `${s.roomId} (${formatMinutes(s.minutes)})`).join(", ");
        lines.push(`איטיים: ${slow}`);
      }
    }
  }

  if (stats.groupFilter === "all" || stats.groupFilter === "ops_calls") {
    if (stats.teamAvgResolveMinutes !== null) {
      lines.push("");
      lines.push(`⏱️ זמן ממוצע לסגירת קריאה (צוות): ${formatMinutes(stats.teamAvgResolveMinutes)}`);
    }
  }

  if (stats.guestAlerts.opened > 0) {
    lines.push("");
    lines.push(
      `📋 בקשות אורחים: ${stats.guestAlerts.resolved}/${stats.guestAlerts.opened} נסגרו` +
      (stats.guestAlerts.avgResolveMinutes !== null
        ? ` · ממוצע ${formatMinutes(stats.guestAlerts.avgResolveMinutes)}`
        : ""),
    );
  }

  lines.push("");
  lines.push(composeTeamOpsActionHint(stats));

  return lines.join("\n");
}

/**
 * Compact team section for Eliad's daily resort digest — CEO KPIs only.
 * Full drill-down remains via get_team_ops_analytics / composeTeamOpsMessage.
 */
export function composeDigestTeamOpsSection(stats: TeamOpsStats): string[] {
  const hasPresence = stats.presence.length > 0;
  const hasOperational = stats.operational.length > 0;
  const hk = stats.housekeepingTurnaround;
  const hasHk = hk.pairs > 0;
  const hasResolve = stats.teamAvgResolveMinutes !== null;
  const hasAlerts = stats.guestAlerts.opened > 0;

  if (!hasPresence && !hasOperational && !hasHk && !hasResolve && !hasAlerts) {
    return [];
  }

  const lines: string[] = ["", "👥 צוות:"];

  if (stats.coverageNote && stats.loggedMessageCount < 10) {
    lines.push(`  ${stats.coverageNote}`);
  }

  const adirPresence = stats.presence.find((p) => p.displayName === "אדיר");
  const adirOp = stats.operational.find((o) => o.displayName === "אדיר");
  if (adirPresence || adirOp) {
    const parts: string[] = [];
    if (adirPresence?.presencePct !== null && adirPresence?.presencePct !== undefined) {
      parts.push(`נוכחות ${adirPresence.presencePct}%`);
    }
    if (adirOp?.operationalSharePct !== null && adirOp?.operationalSharePct !== undefined) {
      parts.push(`מעורבות תפעולית ${adirOp.operationalSharePct}%`);
    }
    if (adirOp?.avgResolveMinutes !== null && adirOp?.avgResolveMinutes !== undefined) {
      parts.push(`סגירה ממוצעת ${formatMinutes(adirOp.avgResolveMinutes)}`);
    }
    if (parts.length) lines.push(`  אדיר: ${parts.join(" · ")}`);
  }

  if (hasResolve) {
    lines.push(`  ⏱️ זמן סגירת קריאה (צוות): ${formatMinutes(stats.teamAvgResolveMinutes)}`);
  }

  if (hasHk) {
    lines.push(
      `  🛏️ checkout→מוכן: ממוצע ${formatMinutes(hk.avgMinutes)}` +
      ` · חציון ${formatMinutes(hk.medianMinutes)} (${hk.pairs} חדרים)`,
    );
    if (hk.slowest.length) {
      const slow = hk.slowest
        .slice(0, 2)
        .map((s) => `${s.roomId} (${formatMinutes(s.minutes)})`)
        .join(", ");
      lines.push(`  איטיים: ${slow}`);
    }
  }

  if (hasAlerts) {
    const ga = stats.guestAlerts;
    lines.push(
      `  📋 בקשות אורחים: ${ga.resolved}/${ga.opened} נסגרו` +
      (ga.avgResolveMinutes !== null ? ` · ממוצע ${formatMinutes(ga.avgResolveMinutes)}` : ""),
    );
  }

  const hint = composeTeamOpsActionHint(stats);
  if (hint && !hint.startsWith("✅")) {
    lines.push(`  ${hint}`);
  }

  return lines;
}

export function composeTeamOpsActionHint(stats: TeamOpsStats): string {
  const person = stats.personFilter;
  const op = stats.operational[0];
  const slow = stats.housekeepingTurnaround.slowest[0];

  if (person && stats.operational.length === 1) {
    const p = stats.operational[0];
    const presence = stats.presence.find((x) => x.displayName === p.displayName);
    if (presence && p.operationalSharePct !== null && presence.presencePct !== null) {
      if (p.operationalSharePct > presence.presencePct + 15) {
        return `👉 ${person} פעיל תפעולית (${p.operationalSharePct}% פעולות) יותר ממה שמשקף בנוכחות (${presence.presencePct}%) — מעורבות אפקטיבית.`;
      }
      if (presence.presencePct > 25 && p.operationalSharePct !== null && p.operationalSharePct < 10) {
        return `👉 ${person} כותב/ת הרבה בקבוצה (${presence.presencePct}%) אבל מעט פעולות תפעוליות — שווה לבדוק אם צריך יותר מעורבות בשטח.`;
      }
    }
    if (p.avgResolveMinutes !== null && stats.teamAvgResolveMinutes !== null) {
      if (p.avgResolveMinutes < stats.teamAvgResolveMinutes - 5) {
        return `👉 ${person} סוגר/ת קריאות מהר מהממוצע (${formatMinutes(p.avgResolveMinutes)} מול ${formatMinutes(stats.teamAvgResolveMinutes)}).`;
      }
      if (p.avgResolveMinutes > stats.teamAvgResolveMinutes + 10) {
        return `👉 לבדוק עומס על ${person} — סגירה ממוצעת ${formatMinutes(p.avgResolveMinutes)} (צוות: ${formatMinutes(stats.teamAvgResolveMinutes)}).`;
      }
    }
  }

  if (slow && slow.minutes >= 180) {
    return `👉 לבדוק turnaround בחדר ${slow.roomId} — ${formatMinutes(slow.minutes)} מ-checkout עד מוכן.`;
  }

  if (op && op.operationalSharePct !== null && op.operationalSharePct >= 40 && !person) {
    return `👉 ${op.displayName} מוביל/ה במעורבות תפעולית (${op.operationalSharePct}%) — שווה לוודא שאין עומס יתר.`;
  }

  if (stats.guestAlerts.opened > stats.guestAlerts.resolved) {
    const open = stats.guestAlerts.opened - stats.guestAlerts.resolved;
    return `👉 ${open} בקשות אורחים עדיין פתוחות בלוח — כדאי לבדוק בלוח הבקשות.`;
  }

  return "✅ אין חריגה בולטת בתקופה — המשך מעקב שוטף.";
}
